import type { TextItem } from './types'

interface PdfTextContent {
  items: ReadonlyArray<object>
}

/** Convert pdf.js text content into our TextItem shape. Shared by the browser and the Node tests. */
export function toTextItems(content: PdfTextContent, page: number): TextItem[] {
  return content.items
    .filter((i): i is { str: string; transform: number[] } => 'str' in i && 'transform' in i)
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], page }))
}

/**
 * Extract positioned text from a PDF in the browser.
 * pdf.js (~1 MB) is loaded only when the user imports a PDF, and parses in a Web Worker.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<TextItem[]> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  try {
    const items: TextItem[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      items.push(...toTextItems(await page.getTextContent(), p))
    }
    return items
  } finally {
    await doc.destroy()
  }
}
