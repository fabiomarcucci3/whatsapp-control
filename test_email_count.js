require('dotenv').config({ path: 'C:/Users/bambo/Desktop/whatsapp-control/.env' });
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

const imapConfig = {
    imap: {
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        host: process.env.IMAP_HOST,
        port: process.env.IMAP_PORT,
        tls: process.env.IMAP_TLS === 'true',
        authTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

async function testMonth(startDateStr, endDateStr, monthName) {
    let connection;
    try {
        connection = await imaps.connect(imapConfig);
        await connection.openBox('INBOX');

        const formatImapDate = (date) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
        };

        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);

        // IMAP search stringente come nel main
        const searchCriteria = [
            ['SINCE', formatImapDate(startDate)], 
            ['BEFORE', formatImapDate(new Date(endDate.getTime() + 86400000))]
        ];
        
        console.log(`\n=== Testing ${monthName} dal ${formatImapDate(startDate)} al ${formatImapDate(endDate)} ===`);
        
        const fetchOptions = { bodies: ['HEADER.FIELDS (SUBJECT DATE)'], struct: true };
        const allMessages = await connection.search(searchCriteria, fetchOptions);
        
        let newBookingCount = 0;
        let cancelledCount = 0;
        let strictDatePassedCount = 0;
        
        for (const item of allMessages) {
            const parts = item.parts[0].body;
            const subjMatch = parts.match(/^Subject:\s*(.*)$/m);
            const subject = subjMatch ? subjMatch[1].trim() : '';
            const dateMatch = parts.match(/^Date:\s*(.*)$/m);
            const rawDate = dateMatch ? dateMatch[1].trim() : null;

            let passedStrictFilter = true;
            if (rawDate) {
                const eD = new Date(rawDate); eD.setHours(0,0,0,0);
                const sD = new Date(startDate); sD.setHours(0,0,0,0);
                const endD = new Date(endDate); endD.setHours(0,0,0,0);
                if (eD < sD || eD > endD) {
                    passedStrictFilter = false;
                }
            } else {
                passedStrictFilter = false;
            }

            if (passedStrictFilter) {
                 strictDatePassedCount++;
                 if(subject.includes('Nuova prenotazione')) {
                      newBookingCount++;
                 } else if(subject.includes('CANCELLAZIONE') || subject.includes('Cancellazione')) {
                      cancelledCount++;
                 }
            }
        }
        
        console.log(`- Messaggi IMAP fetchati: ${allMessages.length}`);
        console.log(`- Messaggi passati dal filtro Strict Data: ${strictDatePassedCount}`);
        console.log(`- Fra i passati, "Nuova prenotazione": ${newBookingCount}`);
        console.log(`- Fra i passati, "CANCELLAZIONE":      ${cancelledCount}`);
        console.log(`- Totale Email Rilevanti (Arrivi + Canc): ${newBookingCount + cancelledCount}`);
        
    } catch(err) {
        console.error(err);
    } finally {
        if(connection) connection.end();
    }
}

async function run() {
    // Febbraio Screenshot = 765, Gennaio Screenshot = 980
    await testMonth('2026-02-01', '2026-02-28', 'Febbraio');
    await testMonth('2026-01-01', '2026-01-31', 'Gennaio');
}
run();
