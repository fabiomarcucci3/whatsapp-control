require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { getVoiceReport } = require('./hybrid_agent');
const fs = require('fs');
const cron = require('node-cron');
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('📧 FastCar Report Agent is running!');
});

app.listen(port, () => {
    console.log(`🌐 Server in ascolto sulla porta ${port}`);
});

const transporter = nodemailer.createTransport({
    host: process.env.IMAP_HOST,
    port: 465,
    secure: true,
    auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
    }
});

const DEST_TITOLARE = 'fabiomarcucci70@gmail.com';
const DEST_EXTRA = 'monica10.mm@gmail.com';

function setupCronJobs() {
    console.log('🕒 Configurazione Job Cron: 13:00, 20:00 (Solo Titolare) e 00:01 (Tutti)...');

    cron.schedule('0 13 * * *', () => {
        console.log('\n[CRON] Esecuzione job 13:00: Invio Email (Solo Titolare)');
        sendEmailReport({ type: 'daily', targetDate: new Date() }, false);
    }, { scheduled: true, timezone: "Europe/Rome" });

    cron.schedule('0 20 * * *', () => {
        console.log('\n[CRON] Esecuzione job 20:00: Invio Email (Solo Titolare)');
        sendEmailReport({ type: 'daily', targetDate: new Date() }, false);
    }, { scheduled: true, timezone: "Europe/Rome" });

    cron.schedule('1 0 * * *', () => {
        console.log('\n[CRON] Esecuzione job 00:01: Invio Email Definitiva (Tutti)');
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        sendEmailReport({ type: 'daily', targetDate: yesterday }, true);
    }, { scheduled: true, timezone: "Europe/Rome" });

    cron.schedule('1 0 * * 0', () => {
        const end = new Date();
        end.setDate(end.getDate() - 1);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        sendEmailReport({ type: 'weekly', startDate: start, endDate: end }, false);
    }, { scheduled: true, timezone: "Europe/Rome" });

    cron.schedule('5 0 1 * *', () => {
        const endLastMonth = new Date();
        endLastMonth.setDate(0);
        const startLastMonth = new Date(endLastMonth.getFullYear(), endLastMonth.getMonth(), 1);
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
    }, { scheduled: true, timezone: "Europe/Rome" });
}

async function sendEmailReport(config, sendToAll) {
    try {
        const type = config.type || 'daily';
        console.log(`[Report] Inizio generazione procedura email ${type.toUpperCase()}...`);
        const { text, audioPath } = await getVoiceReport(config);

        let destinatari = DEST_TITOLARE;
        if (sendToAll && DEST_EXTRA) {
            destinatari = `${DEST_TITOLARE}, ${DEST_EXTRA}`;
        }

        let subjectLine = '';
        if (type === 'daily') subjectLine = `📊 Report FastCar del ${config.targetDate.toLocaleDateString('it-IT')}`;
        else if (type === 'weekly') subjectLine = `📅 Report Settimanale FastCar`;
        else if (type === 'monthly') subjectLine = `🏆 Report MENSILE FastCar`;

        await transporter.sendMail({
            from: `"FastCar Report Agent" <${process.env.IMAP_USER}>`,
            to: destinatari,
            subject: subjectLine,
            text: `Ciao! In allegato trovi il report vocale ${type}.\n\nRiepilogo:\n${text}\n\nBuon Lavoro!\nAgente FastCar`,
            attachments: [{
                filename: `Report_${type.toUpperCase()}.mp3`,
                path: audioPath,
                contentType: 'audio/mpeg'
            }]
        });
        console.log(`✅ Email ${type} inviata con successo!`);
    } catch (err) { console.error('❌ Errore Email:', err); }
}

setupCronJobs();
