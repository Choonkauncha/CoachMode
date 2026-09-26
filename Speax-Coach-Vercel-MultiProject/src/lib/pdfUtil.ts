import * as pdfjsLib from 'pdfjs-dist';

// Setting worker path to point to the installed pdfjs-dist worker in node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    console.log(`[PDF] Starting extraction for file: ${file.name} (${pdf.numPages} pages)`);
    
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`[PDF] Extracting page ${i}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    console.log(`[PDF] Extraction complete. Total characters: ${fullText.length}`);
    return fullText;
  } catch (error) {
    console.error("[PDF] Extraction error:", error);
    throw new Error("Failed to read PDF file. Please ensure it's a valid PDF.");
  }
}
