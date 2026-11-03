/*
 * レシート写真から【店舗名・利用日・合計金額】（＋税の区分・費目）を読み取る本体。
 *
 * 元は renova18.5 の lib/receiptExtraction.ts（2026-11-03 に写した）。XenoReceipt では
 * これが正本になる。プロンプトがこの機能の本体なので、直したら ProcNova にも配ること。
 * 建設現場向けの言い回しだけ外し、一般の経費のレシートとして読ませている。
 */
import { openai } from "@/lib/openai";
import { categoryInstructions } from "@/lib/receiptCategory";

const MODELS = ["gpt-5.6-terra", "gpt-5.4", "gpt-5.1"];

/**
 * レシート写真から【店舗名・利用日・合計金額】の3項目だけを読み取る。
 *
 * 【この機能の鉄則：品目は読まない・推測しない】
 * - レシートの商品名は略称や独自表記が多く、品目まで読むと誤認識が増えてUIも複雑になる。
 *   確認する項目は3つで足りるので、それ以外は返さない。
 * - 読めなかった項目は空にする。一般知識で「よくある店名」に直したりしない。
 * - 金額は必ず「合計」を採る。小計・消費税・お預り・お釣り・ポイントは採らない。
 * - 全く読み取れない場合は readable=false を返し、呼び出し側は撮影画像を保持したまま
 *   手入力フォームを出す。経費登録そのものをAIに依存させない。
 */
const SYSTEM_PROMPT = `あなたは日本のレシート・領収書を読み取る担当者です。
渡された画像から、次の3項目【だけ】を抽出してJSONで返してください。

1. storeName … 店舗名・発行者名
2. date       … 利用日（YYYY-MM-DD形式）
3. totalAmount … 支払合計金額（円・整数）

【厳守事項】
- 画像から実際に判読できた内容だけを返す。推測・補完は一切しない。
- 品目（買った商品）は読み取らない。返さない。

【storeName】
- レシート上部の店名・会社名をそのまま写す。半角カナは全角に直してよい。
- 「〇〇店」「〇〇支店」などの支店名が付いていればそのまま含める。
- 「領収書」「レシート」「お買上票」などの帳票名は店舗名ではない。
- 読めなければ空文字 "" にする。実在しそうな店名で埋めてはならない。

【date】
- レシートに印字された利用日・発行日を YYYY-MM-DD にする。
  例：「2026年09月05日」→「2026-09-05」、「26/09/05」→「2026-09-05」、
      「令和8年9月5日」→「2026-09-05」（和暦は西暦へ直す）
- 年が印字されておらず月日しか無い場合は、参考情報として渡される「今日の日付」の年を使う。
  ただし、それだと未来日になる場合は前年とする。
- 時刻は含めない。読めなければ空文字 "" にする。

【totalAmount】（最も間違いが多い項目）
- 「合計」「お会計」「税込合計」「ご請求額」「領収金額」の金額を採る。
- 次のものを合計と取り違えてはならない：
  小計／内消費税／消費税等／課税対象額／お預り／お預かり／現金／お釣り／釣銭／
  ポイント／値引／クレジット払以外の内訳／個々の商品の金額
- 「小計」と「合計」が両方あるときは必ず「合計」を採る。
- 「お預り 10,000 / 合計 20,000」のように、お預りの方が小さくても合計を採る。
- 【割引・値引は合計ではない】「割引」「値引」「サービス券」「減額」の行の金額は、差し引かれた額であって支払った額ではない。
  割引があるときの合計は、割引を差し引いたあとの額。
  例（駐車場）：「駐車料金 2,500円／割引 2,000円／現金 500円／釣銭 0円」→ 合計は 500（2,000 でも 2,500 でもない）
- 【「合計」の行が無いレシート】駐車場・自販機・券売機などは「合計」と印字されないことがある。
  そのときは「領収金額」「お支払」「請求額」などの行を採る。それも無ければ、
  支払手段の行（「現金」「クレジット」など）の額から釣銭を引いた額を採る。
  料金と割引が印字されていれば、料金 − 割引 がその額と一致することを確かめる。
- 数字は「¥」「円」「,」を除いた整数にする（¥20,000 → 20000）。
- 読めなければ 0 にする。金額を推測してはならない。

【taxable10Amount / taxable8Amount / taxFreeAmount】（消費税の区分。税抜の額を出すのに使う）
- レシートに印字されている区分ごとの【対象額（税込）】をそのまま写す。
  「10%対象 ¥1,080」→ taxable10Amount は 1080
  「8%対象 ¥540」「軽減税率対象 ¥540」→ taxable8Amount は 540
  「非課税対象額 ¥5」「不課税 ¥5」「非課税 ¥5」→ taxFreeAmount は 5
- 「内消費税」「消費税等」の【税額】ではない。対象額のほうを採る。
  対象額が印字されておらず税額しか無い場合は、税額から逆算してはならない（0にする）。
- 【外税のレシートに注意】同じ税率の対象額が2回印字されることがある。
  例：「(外税8%対象額) ¥3,834」「(外税 8%) ¥307」…これは税抜と税額
      「(税率8%対象額) ¥4,141」「(内消費税等 8%) ¥307」…こちらが税込
  区分の対象額を足すと【合計】と一致するほう（この例では 4,141）を採る。
  「外税」と書かれた対象額は税抜なので採らない。
- 3つの対象額の合計は、ふつう合計金額（totalAmount）と一致する。
  読めた区分の対象額だけを写し、読めない区分だけを 0 にする（読めた区分まで 0 にしない）。
- 商品行の「※」「＊」印は軽減税率の目印、「非」印は非課税の目印だが、
  そこから金額を足し上げてはならない。合計欄に区分が印字されているときだけ読む。
- 区分の印字が無いレシートは、3つとも 0 にする（呼び出し側が既定で扱う）。
- 推測しない。読めたものだけを返す。

【taxAmount】（印字されている消費税額）
- 「うち消費税」「内消費税等」「消費税等」「消費税相当額」などとして印字されている税額（円・整数）を写す。
  例：「うち、消費税相当額 0円」→ 0、「(内消費税等 10%) ¥660」→ 660
- 税率ごとに分けて印字されていれば足す。同じ税率の税額が2回印字されていても、1回だけ数える。
- 税額の印字が無ければ -1 にする。0 は「0円と印字されている」ときだけ（印字が無いのを 0 にしない）。

【hasMultipleTaxRates】（税率が混ざっているか）
- レシートに税率の区分が2つ以上あれば true。
  例：「10%対象」と「8%対象」が両方ある／軽減税率の「※」印の商品と印の無い商品が並んでいる／「非課税」の行がある
- 区分ごとの金額が読めなくても、2つ以上あると分かれば true にする。
- 金額が 0円の区分（「8%対象 ¥0」など）は数えない。
- 区分が1つだけ、または判断できないときは false。

【readable】
- 3項目（店舗名・利用日・合計金額）のうち1つでも読み取れたら true。
  税の区分は読めなくても true のままでよい。
- レシートではない画像、または全く判読できない場合は false にし、
  specs 以外のフィールドは空にする。`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "storeName", "date", "totalAmount", "taxable10Amount", "taxable8Amount", "taxFreeAmount", "taxAmount", "hasMultipleTaxRates"],
  properties: {
    readable: {
      type: "boolean",
      description: "3項目のうち1つでも読み取れたか。レシートでない画像は false",
    },
    storeName: { type: "string", description: "店舗名。読めなければ空文字" },
    date: {
      type: "string",
      description: "利用日 YYYY-MM-DD。読めなければ空文字",
    },
    totalAmount: {
      type: "integer",
      description: "支払合計金額（円）。小計・消費税・お預りではない。読めなければ0",
    },
    taxable10Amount: {
      type: "integer",
      description: "10%対象の金額（税込）。税額ではなく対象額。印字が無ければ0",
    },
    taxable8Amount: {
      type: "integer",
      description: "8%（軽減税率）対象の金額（税込）。税額ではなく対象額。印字が無ければ0",
    },
    taxFreeAmount: {
      type: "integer",
      description: "非課税・不課税対象の金額。税抜＝税込。印字が無ければ0",
    },
    taxAmount: {
      type: "integer",
      description: "印字されている消費税額の合計（円）。「0円」と印字されていれば0、印字が無ければ-1",
    },
    hasMultipleTaxRates: {
      type: "boolean",
      description: "税率の区分が2つ以上あるか。金額が読めなくても、区分が2つ以上あると分かれば true",
    },
  },
} as const;

/** data URL の上限。スマホ写真1枚（長辺1600のJPEG）を想定して余裕を持たせる */
export const MAX_IMAGE_CHARS = 8_000_000;

/** 一般経費の費目の候補。空白を落とし、重複と長すぎるものを除く */
export function normalizeCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value !== "" && value.length <= 40);
  return [...new Set(names)].slice(0, 50);
}

/**
 * 出力の形。費目の候補を渡されたときだけ category を足し、候補の中から選ばせる。
 * 候補が無ければ費目の欄を持たない形にする。
 */
export function outputSchemaFor(categories: string[]): Record<string, unknown> {
  if (categories.length === 0) return OUTPUT_SCHEMA as unknown as Record<string, unknown>;
  return {
    ...OUTPUT_SCHEMA,
    required: [...OUTPUT_SCHEMA.required, "category"],
    properties: {
      ...OUTPUT_SCHEMA.properties,
      category: {
        type: "string",
        enum: [...categories, ""],
        description: "一般経費の費目。候補の中から1つ。決めきれなければ空文字",
      },
    },
  };
}

export type Extracted = {
  storeName: string;
  date: string;
  totalAmount: number;
  /** 10%対象の金額（税込）。読めなければ0 */
  taxable10Amount: number;
  /** 8%（軽減税率）対象の金額（税込）。読めなければ0 */
  taxable8Amount: number;
  /** 非課税・不課税対象の金額。税抜＝税込なので割らない。読めなければ0 */
  taxFreeAmount: number;
  /** 税率の区分が2つ以上あるか。金額まで読めなくても、区分が見つかれば true */
  hasMultipleTaxRates: boolean;
  /** 一般経費の費目（渡された候補の中から AI が選んだもの）。候補が無い・決めきれないときは空 */
  category: string;
};

type TaxBuckets = Pick<Extracted, "taxable10Amount" | "taxable8Amount" | "taxFreeAmount">;

/** 区分ごとの丸めで、区分の合計と合計金額がずれてよい幅（円） */
const ROUNDING_TOLERANCE = 2;

/** 区分の合計が合計金額と±2円以内なら、差をいちばん大きい区分に寄せて合計にそろえる。外れていれば null */
function alignToTotal(totalAmount: number, buckets: TaxBuckets): TaxBuckets | null {
  const residual = totalAmount - (buckets.taxable10Amount + buckets.taxable8Amount + buckets.taxFreeAmount);
  if (Math.abs(residual) > ROUNDING_TOLERANCE) return null;
  const aligned = { ...buckets };
  const keys = ["taxable10Amount", "taxable8Amount", "taxFreeAmount"] as const;
  const largest = keys.reduce((best, key) => (aligned[key] > aligned[best] ? key : best), keys[0]);
  aligned[largest] += residual;
  return aligned;
}

/** 印字されている消費税額。「0円」と印字なら0。印字が無い・読めないときは -1 */
export function normalizePrintedTax(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return -1;
  const value = Math.round(raw);
  if (value < 0 || value > 100_000_000) return -1;
  return value;
}

/**
 * 区分の対象額が印字されていないレシートで、印字された税額から税率を決める。
 *
 * 【なぜ要るか】
 * 電話料金の領収証のように「うち、消費税相当額 0円」とだけ刷ってあるものがある。
 * 区分の対象額が無いので3つとも 0 になり、画面は既定の「課税10%」を出していた。
 * 税額が 0 円と印字されていれば、合計ぜんぶが消費税の対象外。
 *
 * 税額が 0 でなければ、税抜（合計−税額）に 10% と 8% を掛けて、印字の税額と合うほうを採る
 *（内税で「内消費税等 ¥80」とだけ刷ってある弁当のレシートなど）。
 * どちらとも合う・どちらとも合わないとき（税率が混ざっている等）は決めない。
 */
export function bucketsFromPrintedTax(totalAmount: number, printedTax: number): TaxBuckets {
  const none: TaxBuckets = { taxable10Amount: 0, taxable8Amount: 0, taxFreeAmount: 0 };
  if (totalAmount <= 0 || printedTax < 0 || printedTax >= totalAmount) return none;
  if (printedTax === 0) return { ...none, taxFreeAmount: totalAmount };
  const exTax = totalAmount - printedTax;
  const matches = (rate: number) => Math.abs(Math.round((exTax * rate) / 100) - printedTax) <= 1;
  const ten = matches(10);
  const eight = matches(8);
  if (ten === eight) return none;
  return ten ? { ...none, taxable10Amount: totalAmount } : { ...none, taxable8Amount: totalAmount };
}

/**
 * 読み取った税率ごとの対象額を、合計金額にそろえる。
 *
 * 【合わないときも捨てない】
 * 前は、区分の合計が合計金額と合わなければ3つとも 0 にして、単一税率（10%）へ倒していた。
 * すると税率の混ざったレシートでも、取り込んだ画面には「10%」しか出ず、見ても混ざって
 * いることに気づけない。読んだ内訳はそのまま返し、合っていないことは画面で知らせる。
 *
 * 【外税は税込へ戻す】
 * 外税のレシートは、同じ税率の対象額を税抜と税込で2回印字する。AIが税抜のほうを
 * 拾ったときは、税率を掛けて戻すと合計に合う。合えば税込へ直して使う。
 *
 * 【端数はいちばん大きい区分で吸収する】
 * 区分ごとの丸めで、合計と1〜2円ずれることがある。そのまま使うと、登録する合計が
 * レシートの合計と違ってしまうので、差をいちばん大きい区分に寄せる。
 */
export function reconcileTaxBuckets(totalAmount: number, buckets: TaxBuckets): TaxBuckets {
  const read: TaxBuckets = {
    taxable10Amount: buckets.taxable10Amount,
    taxable8Amount: buckets.taxable8Amount,
    taxFreeAmount: buckets.taxFreeAmount,
  };
  const sum = read.taxable10Amount + read.taxable8Amount + read.taxFreeAmount;
  if (sum <= 0 || totalAmount <= 0) return read;
  const asRead = alignToTotal(totalAmount, read);
  if (asRead) return asRead;
  const fromTaxExclusive = alignToTotal(totalAmount, {
    taxable10Amount: Math.round((read.taxable10Amount * 110) / 100),
    taxable8Amount: Math.round((read.taxable8Amount * 108) / 100),
    taxFreeAmount: read.taxFreeAmount,
  });
  return fromTaxExclusive ?? read;
}

/**
 * 税率が混ざっているとみなすか。
 *
 * 区分が2つ以上読めたら、AIの判定が漏れていても混ざっている。
 * 読めた区分で合計がぴったり説明できるなら、区分の数だけで決める。「8%対象 ¥0」が
 * 刷ってあるだけで AI が混在と答えることがあり、それを信じると、画面は内訳を開いたのに
 * 区分が1つしか埋まらず、登録で止まっていた。
 * 区分で合計を説明できないとき（読めない・合わない）だけ、AIの判定を使う。
 */
export function hasMixedTaxRates(totalAmount: number, buckets: TaxBuckets, modelSaysMixed: boolean): boolean {
  const amounts = [buckets.taxable10Amount, buckets.taxable8Amount, buckets.taxFreeAmount];
  if (amounts.filter((amount) => amount > 0).length >= 2) return true;
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  if (sum > 0 && sum === totalAmount) return false;
  return modelSaysMixed;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "2026-09-05" 形式かつ実在する日付か */
export function normalizeDate(raw: unknown): string {
  const value = textValue(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return value;
}

/** 金額。負数・非整数・非現実的な桁は採らない（読み間違いを通さない） */
export function normalizeAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const value = Math.round(raw);
  if (value <= 0 || value > 100_000_000) return 0;
  return value;
}


export async function runExtraction(
  image: string,
  todayJst: string,
  /** 費目の候補。渡したときだけ、AIに1つ選ばせる */
  categories: string[] = [],
): Promise<{ ok: true; data: Extracted; model: string } | { ok: false; unreadable: boolean; error: string }> {
  const userText = `レシートの写真を1枚添付します。店舗名・利用日・合計金額の3項目だけを読み取ってください。参考：今日の日付は ${todayJst} です（年が印字されていないときの補完にだけ使い、印字されている日付を書き換えないこと）。`;
  /*
   * 費目の候補も渡して1つ選ばせる。選んだ費目は画面で「AIが選んだ」と
   * 添えて入れておくだけで、登録は人が確かめてから。決めきれなければ空にさせる
   *（迷って「その他」に入ると、見る側が選び直す必要に気づけない）。
   */
  const categoryText = categoryInstructions(categories);

  let lastError: unknown = null;
  for (const model of MODELS) {
    try {
      const response = await openai.responses.create(
        {
          model,
          store: false,
          input: [
            { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
            {
              role: "user",
              content: [
                { type: "input_text", text: userText + categoryText },
                { type: "input_image", image_url: image, detail: "high" },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "receipt_extraction",
              description: "レシートから判読できた店舗名・利用日・合計金額",
              strict: true,
              schema: outputSchemaFor(categories),
            },
          },
          max_output_tokens: 2000,
        },
        { timeout: 60_000 },
      );

      const rawText = response.output_text?.trim();
      if (!rawText) throw new Error("EMPTY_AI_RESULT");

      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const data: Extracted = {
        storeName: textValue(parsed.storeName).slice(0, 100),
        date: normalizeDate(parsed.date),
        totalAmount: normalizeAmount(parsed.totalAmount),
        taxable10Amount: normalizeAmount(parsed.taxable10Amount),
        taxable8Amount: normalizeAmount(parsed.taxable8Amount),
        taxFreeAmount: normalizeAmount(parsed.taxFreeAmount),
        hasMultipleTaxRates: parsed.hasMultipleTaxRates === true,
        // 候補に無い名前は採らない（AIが言い換えた費目を、そのまま登録させない）
        category: categories.includes(textValue(parsed.category)) ? textValue(parsed.category) : "",
      };
      // 区分の対象額を合計にそろえる。合わなくても捨てない（理由は reconcileTaxBuckets）
      Object.assign(data, reconcileTaxBuckets(data.totalAmount, data));
      // 区分の対象額が無くても、税額が印字されていれば税率を決める（「消費税相当額 0円」なら対象外）
      if (data.taxable10Amount + data.taxable8Amount + data.taxFreeAmount === 0) {
        Object.assign(data, bucketsFromPrintedTax(data.totalAmount, normalizePrintedTax(parsed.taxAmount)));
      }
      // 混ざっているかは、読めた区分を先に見て決める（理由は hasMixedTaxRates）
      data.hasMultipleTaxRates = hasMixedTaxRates(data.totalAmount, data, data.hasMultipleTaxRates);

      // 【鉄則】読み取れなかったら正直に失敗を返す。呼び出し側が手入力へ落とす
      const gotSomething = data.storeName !== "" || data.date !== "" || data.totalAmount > 0;
      if (parsed.readable !== true || !gotSomething) {
        return {
          ok: false,
          unreadable: true,
          error: "読み取りできませんでした。手動で入力してください。",
        };
      }
      return { ok: true, data, model };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    ok: false,
    unreadable: false,
    error: lastError instanceof Error ? lastError.message : "ai_failed",
  };
}
