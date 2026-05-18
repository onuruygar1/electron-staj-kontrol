import fs from "node:fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfWord = {
    text: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type PdfLine = {
    page: number;
    columnIndex: number;
    y: number;
    text: string;
    words: PdfWord[];
};

export type TranscriptCourseRow = {
    code: string;
    name: string;
    k: string;
    h: string;
    p: string;
    t: string;
    raw: string;
};

export type TranscriptTable = {
    tableIndex: number;
    pageStart: number;
    pageEnd: number;
    columnIndexStart: number;
    term: string;
    status?: string;
    gno?: string;
    rows: TranscriptCourseRow[];
    summary?: string;
    rawLines: string[];
};

export type ExtractTranscriptOptions = {
    columnCount?: number;
    yTolerance?: number;
};

const DEFAULT_OPTIONS: Required<ExtractTranscriptOptions> = {
    columnCount: 2,
    yTolerance: 3,
};

export async function extractTranscriptTablesFromPdf(
    filePath: string,
    options: ExtractTranscriptOptions = {},
): Promise<TranscriptTable[]> {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
    };

    const words = await extractWords(filePath);

    const lines = buildLinesInNewspaperOrder(words, {
        columnCount: opts.columnCount,
        yTolerance: opts.yTolerance,
    });

    return parseTranscriptTables(lines);
}

async function extractWords(filePath: string): Promise<PdfWord[]> {
    const data = new Uint8Array(fs.readFileSync(filePath));

    const pdf = await pdfjsLib.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
    }).promise;

    const words: PdfWord[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();

        for (const item of textContent.items) {
            if (!("str" in item)) {
                continue;
            }

            const text = item.str.trim();

            if (!text) {
                continue;
            }

            const transform = item.transform;

            words.push({
                text,
                page: pageNumber,
                x: transform[4],
                y: transform[5],
                width: item.width,
                height: item.height,
            });
        }
    }

    return words;
}

function buildLinesInNewspaperOrder(
    words: PdfWord[],
    options: {
        columnCount: number;
        yTolerance: number;
    },
): PdfLine[] {
    const pages = [...new Set(words.map(word => word.page))].sort((a, b) => a - b);

    const allLines: PdfLine[] = [];

    for (const page of pages) {
        const pageWords = words.filter(word => word.page === page);

        if (pageWords.length === 0) {
            continue;
        }

        const minX = Math.min(...pageWords.map(word => word.x));
        const maxX = Math.max(...pageWords.map(word => word.x + word.width));
        const pageWidth = maxX - minX;
        const columnWidth = pageWidth / options.columnCount;

        for (let columnIndex = 0; columnIndex < options.columnCount; columnIndex++) {
            const columnMinX = minX + columnIndex * columnWidth;
            const columnMaxX =
                columnIndex === options.columnCount - 1
                    ? maxX + 1
                    : minX + (columnIndex + 1) * columnWidth;

            const columnWords = pageWords.filter(word => {
                return word.x >= columnMinX && word.x < columnMaxX;
            });

            const columnLines = groupWordsIntoLines(
                columnWords,
                page,
                columnIndex,
                options.yTolerance,
            );

            allLines.push(...columnLines);
        }
    }

    return allLines.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        if (a.columnIndex !== b.columnIndex) return a.columnIndex - b.columnIndex;
        return b.y - a.y;
    });
}

function groupWordsIntoLines(
    words: PdfWord[],
    page: number,
    columnIndex: number,
    yTolerance: number,
): PdfLine[] {
    const sortedWords = [...words].sort((a, b) => {
        if (Math.abs(b.y - a.y) > yTolerance) {
            return b.y - a.y;
        }

        return a.x - b.x;
    });

    const lines: PdfLine[] = [];

    for (const word of sortedWords) {
        const existingLine = lines.find(line => {
            return Math.abs(line.y - word.y) <= yTolerance;
        });

        if (existingLine) {
            existingLine.words.push(word);
            existingLine.words.sort((a, b) => a.x - b.x);
            existingLine.y = average([existingLine.y, word.y]);
            existingLine.text = wordsToText(existingLine.words);
        } else {
            lines.push({
                page,
                columnIndex,
                y: word.y,
                text: word.text,
                words: [word],
            });
        }
    }

    return lines.sort((a, b) => b.y - a.y);
}

function wordsToText(words: PdfWord[]): string {
    const sorted = [...words].sort((a, b) => a.x - b.x);

    return sorted
        .map(word => word.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseTranscriptTables(lines: PdfLine[]): TranscriptTable[] {
    const tables: TranscriptTable[] = [];

    let current: TranscriptTable | null = null;

    for (const line of lines) {
        const text = normalize(line.text);

        if (isTermTitle(text)) {
            if (current && current.rows.length > 0) {
                tables.push(current);
            }

            current = {
                tableIndex: tables.length,
                pageStart: line.page,
                pageEnd: line.page,
                columnIndexStart: line.columnIndex,
                term: text,
                rows: [],
                rawLines: [text],
            };

            continue;
        }

        if (!current) {
            continue;
        }

        current.pageEnd = line.page;
        current.rawLines.push(text);

        const statusAndGno = parseStatusAndGno(text);

        if (statusAndGno) {
            current.status = statusAndGno.status;
            current.gno = statusAndGno.gno;
            continue;
        }

        if (isSummaryLine(text)) {
            current.summary = text;
            continue;
        }

        const courseRow = parseCourseRow(text);

        if (courseRow) {
            current.rows.push(courseRow);
        }
    }

    if (current && current.rows.length > 0) {
        tables.push(current);
    }

    return tables.map((table, index) => ({
        ...table,
        tableIndex: index,
    }));
}

function isTermTitle(text: string): boolean {
    return /^\d{4}-\d{4}\s+(Güz|Bahar|Yaz)\s+Yarıyılı$/i.test(text);
}

function parseStatusAndGno(
    text: string,
): { status?: string; gno?: string } | null {
    const statusMatch = text.match(/Başarı\s+Durumu\s*:\s*([^\s]+(?:\s+[^\s]+)?)/i);
    const gnoMatch = text.match(/GNO\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);

    if (!statusMatch && !gnoMatch) {
        return null;
    }

    return {
        status: statusMatch?.[1]?.trim(),
        gno: gnoMatch?.[1]?.replace(",", "."),
    };
}

function isSummaryLine(text: string): boolean {
    return /\bYYO\s*:/i.test(text) || /Geç\.\s*AKTS/i.test(text);
}

function parseCourseRow(text: string): TranscriptCourseRow | null {
    const normalized = normalize(text);

    /**
     * Examples from your PDF:
     *
     * CSE101 COMPUTER PROGRAMMING 5 B- 13,5
     * CSE105 PROGRAMMING LABORATORY I 2 B- 5,4
     * ENG110 INTRODUCTION TO COMPUTER ENGINE 4 C- 6,8
     * MATH151 MATEMATİKSEL ANALİZ I 6 C+ 13,8
     * PHY101 FİZİK I 5 C 11,5
     * CSE396 CURRENT TOPICS IN COMPUTER SCIEN 5 XX 0 0
     */
    const match = normalized.match(
        /^([A-ZÇĞİÖŞÜ]{2,}\d{3,}[A-Z]?)\s+(.+?)\s+(\d+)\s+([A-Z]{1,2}[+-]?|XX|F\d?|D|C|B|A)\s+([0-9]+(?:[.,][0-9]+)?)\s*([A-Z0-9]*)?$/i,
    );

    if (!match) {
        return null;
    }

    return {
        code: match[1],
        name: match[2].trim(),
        k: match[3],
        h: match[4],
        p: match[5].replace(",", "."),
        t: match[6] ?? "",
        raw: text,
    };
}

function normalize(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}