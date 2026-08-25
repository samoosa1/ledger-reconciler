/**
 * On-demand loader for SheetJS, shared by the ledger reader and the
 * report writer.
 *
 * SheetJS is the single largest dependency here and neither the landing
 * page nor the extraction step touches it: reading a ledger happens after
 * files are dropped, and writing a report happens after that. Loading it
 * at module scope would put a spreadsheet engine on the critical path of
 * a page whose entire visible content is a drop zone.
 *
 * The module reference is cached, but the ES module registry already
 * dedupes the fetch, so a second caller mid-load waits on the same
 * in-flight request rather than starting another.
 */

let cached: typeof import('xlsx') | undefined

export async function loadXlsx(): Promise<typeof import('xlsx')> {
  cached ??= await import('xlsx')
  return cached
}
