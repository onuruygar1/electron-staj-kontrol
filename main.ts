import { extractTranscriptTablesFromPdf } from "./extractor";

async function main() {
    const tables = await extractTranscriptTablesFromPdf("data.pdf", {
        columnCount: 2,
        yTolerance: 3,
    });

    console.log(`Found ${tables.length} tables`);

    for (const table of tables) {
        console.log("====================================");
        console.log(`Table ${table.tableIndex}`);
        console.log(`Term: ${table.term}`);
        console.log(`Status: ${table.status ?? ""}`);
        console.log(`GNO: ${table.gno ?? ""}`);

        for (const row of table.rows) {
            console.log(row);
        }

        console.log(`Summary: ${table.summary ?? ""}`);
    }

    const firstTable = tables[0];

    if (firstTable) {
        console.log("First table term:", firstTable.term);
        console.log("First course code:", firstTable.rows[0]?.code);
        console.log("First course name:", firstTable.rows[0]?.name);
        console.log("First course grade:", firstTable.rows[0]?.h);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});