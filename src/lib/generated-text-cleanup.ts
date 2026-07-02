export function stripMarkdownHorizontalRules(markdown: string): string {
  return markdown
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
