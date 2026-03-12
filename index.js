require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const express = require('express');

// Dummy server HTTP per far felice Render.com ed evitare Error: Exited with status 1
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('WhatsApp/Email Control Server Attivo 🚀'));
app.listen(port, () => console.log(`[HTTP] Server web avviato sulla porta ${port}`));

const hybridAgent = require('./hybrid_agent.js');

const DEST_FABIO = 'fabiomarcucci70@gmail.com';
const DEST_MONICA = 'monica10.mm@gmail.com'; 

const transporter = nodemailer.createTransport({
    host: process.env.IMAP_HOST,
    port: 465,
    secure: true,
    auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
    }
});

/**
 * Funzione di utilità per generare e inviare i report consolidati (Vocale + Lista Testo)
 */
async function generateAndSendReport(config, filename, subject, toEmails) {
    try {
        console.log(`\n[CRON] Avvio generazione report consolidato: ${subject}`);
        const outputPath = path.join(__dirname, filename);
        
        // 1. Genera il Vocale E recupera i dati (singola connessione IMAP)
        const voiceResult = await hybridAgent.getVoiceReport(config, outputPath);
        const textToSpeak = voiceResult.text; 
        const data = voiceResult.data; 
        const valide = data.bookings || [];
        
        // 2. Costruisci il corpo Email usando i dati già pronti
        let emailText = `Ciao Fabio e Monica,\n\n${textToSpeak}\n\n`;
        emailText += `--- LISTA DETTAGLIATA PRENOTAZIONI (${valide.length} lavorazioni) ---\n\n`;
        
        valide.forEach((b, i) => {
            emailText += `${i+1}. [${b.numero}] ${b.nomeCliente || 'N/D'}\n`;
            emailText += `   Sede: ${b.sedeName || 'N/D'}\n`;
            emailText += `   Servizio: ${b.servizio || 'N/D'}\n`;
            emailText += `   Costo: €${b.emailCostoTotale || 0} (+€${b.emailExtra || 0} extra)\n`;
            emailText += `------------------------------------------------------------\n`;
        });

        const stats = data.ricevute;
        emailText += `\nTOTALE INCASSO STIMATO: €${(stats.incasso || 0).toFixed(2)}\n\nBuon lavoro!\n- FastCar Cloud Agent`;

        // 3. Invia Email
        console.log(`[CRON] Spedizione email consolidata a: ${toEmails.join(', ')}`);
        await transporter.sendMail({
            from: `"FastCar Cloud Agent" <${process.env.IMAP_USER}>`,
            to: toEmails.join(', '),
            subject: subject,
            text: emailText,
            attachments: [{
                filename: filename,
                path: outputPath,
                contentType: 'audio/mpeg'
            }]
        });
        
        console.log(`[CRON] ✅ Invio report completato: ${subject}`);
    } catch (err) {
        console.error(`[CRON] ❌ Errore durante generazione/invio:`, err);
    }
}

console.log("==========================================");
console.log("  FASTCAR CLOUD AGENT SVILUPPO ATTIVO     ");
console.log("==========================================");
console.log("Schedulazioni Standardizzate:");
console.log("- Ogni giorno @ 00:01 -> Report Chiusura Ieri");
console.log("- Ogni giorno @ 12:00 -> Update Oggi (Midday)");
console.log("- Ogni giorno @ 19:00 -> Update Oggi (Evening)");
console.log("- Ogni Lunedì @ 08:00 -> Report Settimanale");
console.log("- 1° del Mese @ 00:01 -> Report Mensile");
console.log("Destinatari: Fabio & Monica\n");


// 1. OGNI GIORNO ORE 00:01 -> CHIUSURA GIORNALIERA (IERI)
cron.schedule('1 0 * * *', async () => {
    const ieri = new Date();
    ieri.setDate(ieri.getDate() - 1);
    await generateAndSendReport(
        { type: 'chiusura', targetDate: ieri }, 
        'vocale_chiusura_ieri.mp3', 
        `📊 Report Chiusura FastCar - ${ieri.toLocaleDateString()}`, 
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });

// 2. OGNI GIORNO ORE 12:00 -> AGGIORNAMENTO OGGI (MIDDAY)
cron.schedule('0 12 * * *', async () => {
    const oggi = new Date();
    await generateAndSendReport(
        oggi, 
        'vocale_update_oggi_12.mp3', 
        `📊 Aggiornamento FastCar Ore 12:00 - ${oggi.toLocaleDateString()}`, 
        [DEST_FABIO]
    );
}, { timezone: "Europe/Rome" });

// 3. OGNI GIORNO ORE 19:00 -> AGGIORNAMENTO OGGI (EVENING)
cron.schedule('0 19 * * *', async () => {
    const oggi = new Date();
    await generateAndSendReport(
        { type: 'chiusura', targetDate: oggi }, 
        'vocale_update_oggi_19.mp3', 
        `📊 Aggiornamento FastCar Ore 19:00 - ${oggi.toLocaleDateString()}`, 
        [DEST_FABIO]
    );
}, { timezone: "Europe/Rome" });

// 4. OGNI LUNEDI ORE 08:00 -> REPORT SETTIMANALE
cron.schedule('0 8 * * 1', async () => {
    const endWeek = new Date();
    endWeek.setDate(endWeek.getDate() - 1); // Fino a ieri (domenica)
    const startWeek = new Date(endWeek);
    startWeek.setDate(endWeek.getDate() - 6);
    await generateAndSendReport(
        { type: 'weekly', startDate: startWeek, endDate: endWeek }, 
        'vocale_settimanale.mp3', 
        `📊 Report Settimanale FastCar (dal ${startWeek.toLocaleDateString()} al ${endWeek.toLocaleDateString()})`, 
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });

// 5. OGNI 1° DEL MESE ORE 00:01 -> REPORT MENSILE
cron.schedule('1 0 1 * *', async () => {
    const startLastMonth = new Date();
    startLastMonth.setDate(1);
    startLastMonth.setMonth(startLastMonth.getMonth() - 1);
    const endLastMonth = new Date(startLastMonth.getFullYear(), startLastMonth.getMonth() + 1, 0);

    const startPriorMonth = new Date(startLastMonth);
    startPriorMonth.setMonth(startPriorMonth.getMonth() - 1);
    const endPriorMonth = new Date(startPriorMonth.getFullYear(), startPriorMonth.getMonth() + 1, 0);

    await generateAndSendReport(
        { 
            type: 'monthly', 
            startDate: startLastMonth, 
            endDate: endLastMonth,
            priorStartDate: startPriorMonth,
            priorEndDate: endPriorMonth
        }, 
        'vocale_mensile.mp3', 
        `📊 Report Mensile FastCar - ${startLastMonth.toLocaleString('it-IT', { month: 'long' }).toUpperCase()}`, 
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });
