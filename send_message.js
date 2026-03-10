require('dotenv').config();
const { getVoiceReport } = require('./report_generator');
const fs = require('fs');
const cron = require('node-cron');
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('📧 App Prenotazioni is running!');
});

app.listen(port, () => {
    console.log(`🌐 Web server in ascolto sulla porta ${port}`);
});

// Configurazione Nodemailer usando gli stessi parametri IMAP del .env !
// Assumendo che il server IMAP sia anche il server SMTP in questo caso
const transporter = nodemailer.createTransport({
    host: process.env.IMAP_HOST,
    port: 465, // Porta standard protetta SSL per l'invio
    secure: true, 
    auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
    }
});

// Indirizzi Email di Destinazione Scelti dall'Utente
const DEST_TITOLARE = 'fabiomarcucci70@gmail.com'; 
const DEST_EXTRA = 'monica10.mm@gmail.com'; 
const DEST_GRUPPO = ''; 

// ----- CONFIGURAZIONE CRON JOBS -----
function setupCronJobs() {
    console.log('🕒 Configurazione Job Cron: 13:00, 20:00 (Solo Titolare) e 00:01 (Tutti)...');
    
    // Ore 13:00: Report di "metà giornata" solo al Titolare
    cron.schedule('0 13 * * *', () => {
        console.log('\n[CRON] Esecuzione job 13:00: Invio Email (Solo Titolare)');
        sendEmailReport(new Date(), false);
    }, {
        scheduled: true,
        timezone: "Europe/Rome"
    });

    // Ore 20:00: Report di oggi solo al Titolare
    cron.schedule('0 20 * * *', () => {
        console.log('\n[CRON] Esecuzione job 20:00: Invio Email (Solo Titolare)');
        sendEmailReport(new Date(), false);
    }, {
        scheduled: true,
        timezone: "Europe/Rome"
    });

    // Ore 00:01: Report giornata scorsa a tutti
    cron.schedule('1 0 * * *', () => {
        console.log('\n[CRON] Esecuzione job 00:01: Invio Email Definitiva (Tutti)');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        sendEmailReport({ type: 'daily', targetDate: yesterday }, true);
    }, {
        scheduled: true,
        timezone: "Europe/Rome"
    });

    // Ore 00:01 (DOMENICA): Report della Settimana precedente (Solo Titolare)
    // 0 nel cron day-of-week è Domenica.
    cron.schedule('1 0 * * 0', () => {
        console.log('\n[CRON] Esecuzione job Domenica 00:01: Invio Email Settimanale (Solo Titolare)');
        const end = new Date();
        end.setDate(end.getDate() - 1); // Sabato
        const start = new Date(end);
        start.setDate(start.getDate() - 6); // Domenica precedente
        sendEmailReport({ type: 'weekly', startDate: start, endDate: end }, false);
    }, {
        scheduled: true,
        timezone: "Europe/Rome"
    });

    // Ore 00:05 (1° DEL MESE): Report del Mese precedente con comparazione (Solo Titolare)
    cron.schedule('5 0 1 * *', () => {
        console.log('\n[CRON] Esecuzione job 1° Mese 00:05: Invio Email Mensile Mese Scorso (Solo Titolare)');
        
        // Mese precedente: dal giorno 1 all'ultimo giorno
        const endLastMonth = new Date();
        endLastMonth.setDate(0); 
        const startLastMonth = new Date(endLastMonth.getFullYear(), endLastMonth.getMonth(), 1);
        
        // Mese antecedente per la comparazione: dal giorno 1 all'ultimo giorno
        const endPriorMonth = new Date(startLastMonth);
        endPriorMonth.setDate(0);
        const startPriorMonth = new Date(endPriorMonth.getFullYear(), endPriorMonth.getMonth(), 1);

        sendEmailReport({
            type: 'monthly',
            startDate: startLastMonth,
            endDate: endLastMonth,
            priorStartDate: startPriorMonth,
            priorEndDate: endPriorMonth
        }, false);
    }, {
        scheduled: true,
        timezone: "Europe/Rome"
    });
}

// Avvia i bot
setupCronJobs();

// Il sistema ora resta in ascolto passivo dei Cron Jobs per inviare ai tempi stabiliti.

// ----- FUNZIONE DI INVIO EMAIL -----
async function sendEmailReport(config, sendToAll) {
    try {
        let type = 'daily';
        if (config.type) type = config.type;
        else config = { type: 'daily', targetDate: config };

        console.log(`[Report] Inizio generazione procedura email ${type.toUpperCase()}...`);
        const { text, audioPath } = await getVoiceReport(config);
        
        let destinatari = DEST_TITOLARE;
        if (sendToAll) {
             const allDest = [DEST_TITOLARE];
             if(DEST_EXTRA) allDest.push(DEST_EXTRA);
             if(DEST_GRUPPO) allDest.push(DEST_GRUPPO);
             destinatari = allDest.join(', ');
        }
        
        console.log(`[Email] Preparazione email per: ${destinatari}...`);

        let attachments = [];
        if (fs.existsSync(audioPath)) {
            attachments.push({
                filename: `ReportVocale_${type.toUpperCase()}.mp3`,
                path: audioPath,
                contentType: 'audio/mpeg'
            });
        }

        let subjectLine = '';
        if (type === 'daily') {
             subjectLine = `📊 Report FastCar del ${config.targetDate.toLocaleDateString('it-IT')}`;
        } else if (type === 'weekly') {
             subjectLine = `📅 Report Settimanale FastCar (${config.startDate.toLocaleDateString('it-IT')} - ${config.endDate.toLocaleDateString('it-IT')})`;
        } else if (type === 'monthly') {
             subjectLine = `🏆 Report MENSILE FastCar (${config.startDate.toLocaleDateString('it-IT')} - ${config.endDate.toLocaleDateString('it-IT')})`;
        }

        const info = await transporter.sendMail({
            from: `"Automazione FastCar" <${process.env.IMAP_USER}>`,
            to: destinatari,
            subject: subjectLine,
            text: `Ciao! In allegato trovi il tuo report vocale quotidiano.\n\nEcco il riepilogo testuale:\n\n${text}\n\nBuon Lavoro!\nApp Prenotazioni`,
            attachments: attachments
        });

        console.log('✅ Email inviata con successo!', info.messageId);

    } catch (err) {
        console.error('❌ Errore durante generazione o invio Email:', err);
    }
}
