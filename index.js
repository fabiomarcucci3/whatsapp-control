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

// Assicuriamoci che hybrid_agent esponga getVoiceReport
const hybridAgent = require('./hybrid_agent.js');

const DEST_FABIO = 'fabiomarcucci70@gmail.com';
const DEST_MONICA = process.env.EMAIL_MONICA || 'monica@fastcar.it'; // Cambiare nel file .env se diversa

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
 * Funzione di utilità per generare e inviare i report
 */
async function generateAndSendReport(config, filename, subject, textBody, toEmails) {
    try {
        console.log(`\n[CRON] Avvio generazione report: ${subject}`);
        const outputPath = path.join(__dirname, filename);
        
        // 1. Genera il Vocale (usa la tua logica agent)
        await hybridAgent.getVoiceReport(config, outputPath);
        
        // 2. Verifica se il file è stato creato
        if (!fs.existsSync(outputPath)) {
            console.error(`[CRON] Errore: File audio non generato in ${outputPath}`);
            return;
        }

        // 3. Invia Email
        console.log(`[CRON] Spedizione email a: ${toEmails.join(', ')}`);
        await transporter.sendMail({
            from: `"FastCar Report Agent" <${process.env.IMAP_USER}>`,
            to: toEmails.join(', '),
            subject: subject,
            text: textBody,
            attachments: [{
                filename: filename,
                path: outputPath,
                contentType: 'audio/mpeg'
            }]
        });
        
        console.log(`[CRON] ✅ Invio report completato: ${subject}`);
    } catch (err) {
        console.error(`[CRON] ❌ Errore durante generazione/invio di ${subject}:`, err);
    }
}

console.log("==========================================");
console.log("  WHATSAPP/EMAIL CONTROL SERVER AVVIATO   ");
console.log("==========================================");
console.log("Schedulazioni attive:");
console.log("- Ogni giorno @ 00:01 -> Report Ieri (Fabio & Monica)");
console.log("- Ogni giorno @ 12:00 -> Report Oggi (Solo Fabio)");
console.log("- Ogni giorno @ 20:00 -> Report Oggi (Solo Fabio)");
console.log("- Ogni Lunedì @ 00:01 -> Report Settimanale (Fabio & Monica)");
console.log("- 1° del Mese @ 00:01 -> Report Mensile (Fabio & Monica)\n");


// 1. TUTTI I GIORNI ORE 00:01 -> RESOCONTO GIORNO PRIMA A MONICA E FABIO
cron.schedule('1 0 * * *', async () => {
    console.log("[CRON 00:01] Esecuzione Report IERI...");
    const ieri = new Date();
    ieri.setDate(ieri.getDate() - 1);
    await generateAndSendReport(
        ieri, 
        'vocale_hybrid_ieri.mp3', 
        `📊 Report Giornaliero FastCar - ${ieri.toLocaleDateString()}`, 
        "Ciao Monica e Fabio,\n\nIn allegato il resoconto vocale delle prenotazioni di ieri.\nBuon ascolto e buon lavoro!\n- FastCar Agent",
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });

// 2. TUTTI I GIORNI ORE 12:00 -> MANDA EMAIL SOLO A FABIO (Oggi)
cron.schedule('0 12 * * *', async () => {
    console.log("[CRON 12:00] Esecuzione Report OGGI Midday...");
    const oggi = new Date();
    await generateAndSendReport(
        oggi, 
        'vocale_hybrid_oggi_12.mp3', 
        `📊 Report Aggiornamento FastCar Ore 12:00 - ${oggi.toLocaleDateString()}`, 
        "Ciao Fabio,\n\nIn allegato il resoconto vocale aggiornato ad ora (12:00) sulle prenotazioni della giornata di oggi.\nBuon ascolto!\n- FastCar Agent",
        [DEST_FABIO]
    );
}, { timezone: "Europe/Rome" });

// 3. TUTTI I GIORNI ORE 20:00 -> MANDA EMAIL SOLO A FABIO (Oggi)
cron.schedule('0 20 * * *', async () => {
    console.log("[CRON 20:00] Esecuzione Report OGGI Sera...");
    const oggi = new Date();
    await generateAndSendReport(
        oggi, 
        'vocale_hybrid_oggi_20.mp3', 
        `📊 Report Serale FastCar Ore 20:00 - ${oggi.toLocaleDateString()}`, 
        "Ciao Fabio,\n\nIn allegato il resoconto vocale serale sulle prenotazioni arrivate nella giornata di oggi.\nBuona serata!\n- FastCar Agent",
        [DEST_FABIO]
    );
}, { timezone: "Europe/Rome" });

// 4. LUNEDI ORE 00:01 -> MANDA REPORT SETTIMANALE a Monica e Fabio
cron.schedule('1 0 * * 1', async () => {
    console.log("[CRON LUNEDI 00:01] Esecuzione Report SETTIMANALE...");
    const endWeek = new Date();
    endWeek.setDate(endWeek.getDate() - 1); // La settimana si chiude la domenica (ieri)
    const startWeek = new Date(endWeek);
    startWeek.setDate(endWeek.getDate() - 6); // Da lunedì precedente a domenica
    await generateAndSendReport(
        { type: 'weekly', startDate: startWeek, endDate: endWeek }, 
        'vocale_hybrid_settimanale.mp3', 
        `📊 Report Settimanale FastCar (dal ${startWeek.toLocaleDateString()} al ${endWeek.toLocaleDateString()})`, 
        "Ciao Monica e Fabio,\n\nIn allegato il resoconto vocale della settimana appena conclusa.\nBuon ascolto e buona settimana!\n- FastCar Agent",
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });

// 5. 1 DEL MESE ORE 00:01 -> MANDA REPORT MENSILE a Monica e Fabio
cron.schedule('1 0 1 * *', async () => {
    console.log("[CRON 1° MESE 00:01] Esecuzione Report MENSILE...");
    
    // Calcoliamo automaticamente "Il mese scorso"
    const startLastMonth = new Date();
    startLastMonth.setDate(1); // Vai al primo giorno del mese attuale
    startLastMonth.setMonth(startLastMonth.getMonth() - 1); // Vai indietro di 1 mese
    
    // Ultimo giorno del mese scorso
    const endLastMonth = new Date(startLastMonth.getFullYear(), startLastMonth.getMonth() + 1, 0);

    // Mese ancora precedente per il confronto
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
        'vocale_hybrid_mensile.mp3', 
        `📊 Report Mensile FastCar - Mese di ${startLastMonth.toLocaleString('it-IT', { month: 'long' }).toUpperCase()} ${startLastMonth.getFullYear()}`, 
        "Ciao Monica e Fabio,\n\nIn allegato il resoconto vocale mensile finale con i dettagli del mese appena concluso.\nBuon lavoro!\n- FastCar Agent",
        [DEST_FABIO, DEST_MONICA]
    );
}, { timezone: "Europe/Rome" });
