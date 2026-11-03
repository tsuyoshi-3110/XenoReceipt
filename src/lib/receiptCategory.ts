/*
 * レシート読み取りで、一般経費の費目をAIに選ばせる指示。
 * OpenAI の呼び出し（receiptExtraction）と分けて、鍵の無いところでも検証できるようにしてある。
 * 元は renova18.5 の lib/receiptCategory.ts（2026-11-03 に写した）。
 */

/**
 * 費目を選ばせる指示。候補が無ければ空。
 *
 * 飲食店は接待交際費、事務所で飲む飲み物は福利厚生費に寄せる。社内だけの食事も
 * 接待交際費に入るが、AIが選んだ費目は画面で「AIが選んだ」と添えて出し、登録前に人が直せる。
 * どちらも、その費目が候補に無ければ空にする。近い費目（会議費・消耗品費など）で代用すると、
 * 選び直す必要に気づけない。
 */
export function categoryInstructions(categories: string[]): string {
  if (categories.length === 0) return "";
  const entertainment = categories.find((name) => name.includes("交際"));
  const welfare = categories.find((name) => name.includes("福利厚生"));
  const pick = (name: string | undefined) => (name ? `「${name}」` : `空文字 ""（候補に合う費目が無いため）`);
  return `
あわせて、この経費の費目を次の候補から1つだけ選び、category に入れてください。
候補：${categories.map((name) => `「${name}」`).join("")}
- 店名と、レシートに印字されている内容（何の支払いか）から判断する。
  例：電話・インターネットの料金 → 通信費／ガソリン・駐車場・高速道路 → 車両費や旅費交通費／文房具・日用品 → 消耗品費／振込手数料 → 支払手数料
- 飲食店（寿司・焼肉・居酒屋・レストラン・カフェなど、店で食事や飲食をした）→ ${pick(entertainment)}
- コンビニ・スーパー・自動販売機などで、飲み物・お茶・コーヒー・水を買った（ウォーターサーバー代も含む）→ ${pick(welfare)}
- 上の2つ（飲食店・飲み物）は、書いたとおりにする。ほかの費目（会議費・消耗品費など）で代用しない。
- それ以外で、例に出した費目が候補に無ければ、候補の中でいちばん近いものを選ぶ。
- 決めきれないとき（コンビニで弁当や食べ物が中心、など）は空文字 "" にする。迷って「その他」を選ばない。`;
}
