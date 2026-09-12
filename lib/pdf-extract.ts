"use client";

/**
 * Extracts text page by page in the browser with pdf.js. The file never leaves the
 * user's machine and large PDFs (up to 50 MB) don't hit serverless upload limits —
 * only the text is sent for analysis.
 */
export interface ExtractedPdf {
  numPages: number;
  pages: { page: number; text: string }[];
  chars: number;
}

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function extractPdfText(file: File, onProgress?: (done: number, total: number) => void): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: { page: number; text: string }[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== "string") continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      pages.push({ page: i, text: text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim() });
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }
  return { numPages: pages.length, pages, chars: pages.reduce((a, p) => a + p.text.length, 0) };
}
