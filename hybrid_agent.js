require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { MsEdgeTTS } = require('msedge-tts');
const { OUTPUT_FORMAT } = require('msedge-tts/dist/Output');

// ============================================================
// CONFIGURAZIONE
// ============================================================
const SEDI_PROPRIE = ['Ciamarra', 'Colli', 'Granai', 'Tivoli', 'Primavalle'];

const imapConfig = {
    imap: {
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASS,
        host: process.env.IMAP_HOST,
        port: parseInt(process.env.IMAP_PORT, 10) || 993,
        tls: process.env.IMAP_TLS === 'true',
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

// ============================================================
// HELPERS
// ============================================================
function isSedePropria(sedeName) {
    if (!sedeName) return false;
    const sedeNorm = sedeName.toLowerCase();
    return SEDI_PROPRIE.some(s => sedeNorm.includes(s.toLowerCase()));
}

function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/┬á/g, ' ').replace(/Ôé¼/g, '€').trim();
}

function simplifyServizio(servizio) {
    if (!servizio) return 'Non specificato';
    let simple = servizio
        .replace(/\s*-\s*(Auto|Moto|Scooter|Furgone).*$/i, '')
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/\s*€\d+.*$/i, '')
        .trim();
    return simple || servizio;
}

function detectGenere(nomeCliente) {
    if (!nomeCliente) return 'Non specificato';
    const nome = nomeCliente.trim().split(/\s+/)[0].toLowerCase();
    const femminili = ['maria', 'anna', 'giulia', 'francesca', 'sara', 'laura', 'valentina', 'alessia', 'chiara', 'elena', 'silvia', 'paola', 'daniela', 'barbara', 'simona', 'monica', 'cristina', 'claudia', 'roberta', 'federica', 'martina', 'elisa', 'ilaria', 'manuela', 'patrizia', 'rosa', 'giovanna', 'antonella', 'luca', 'carla', 'angela', 'alessandra', 'sabrina', 'eleonora', 'serena', 'veronica', 'rachele', 'beatrice', 'arianna', 'miriam', 'irene', 'nadia', 'luisa', 'teresa', 'stefania', 'cinzia', 'marta', 'elisabetta', 'sonia', 'tiziana', 'giorgia', 'jessica', 'noemi', 'aurora', 'greta', 'camilla', 'alice', 'flavia', 'michela', 'lucia', 'viviana', 'lorena', 'ornella', 'katia', 'fabiana', 'liliana', 'emma', 'sofia', 'bianca', 'adele'];
    const maschili = ['marco', 'luca', 'andrea', 'giuseppe', 'giovanni', 'antonio', 'francesco', 'alessandro', 'matteo', 'lorenzo', 'stefano', 'roberto', 'paolo', 'michele', 'davide', 'fabio', 'massimo', 'daniele', 'alberto', 'simone', 'federico', 'riccardo', 'claudio', 'giorgio', 'vincenzo', 'nicola', 'emanuele', 'tommaso', 'filippo', 'carlo', 'gabriele', 'enrico', 'salvatore', 'mario', 'bruno', 'sergio', 'franco', 'maurizio', 'pierpaolo', 'gianluca', 'luigì', 'pietro', 'angelo', 'raffaele', 'valerio', 'christian', 'manuel', 'edoardo', 'samuele', 'diego', 'leonardo'];
    if (femminili.includes(nome)) return 'Donna';
    if (maschili.includes(nome)) return 'Uomo';
    if (nome.endsWith('a') && !['luca', 'andrea', 'nicola'].includes(nome)) return 'Donna';
    return 'Uomo';
}



// ============================================================
// 2. FETCH DA EMAIL
// ============================================================
function parseEmailData(subject, bodyHtml) {
    const result = {
        numero: null,
        cancellato: false,
        emailCostoTotale: 0,
        emailExtra: 0,
        sedeName: null,
        nomeCliente: null,
        servizio: null,
        dataTrattamento: null
    };
    const txt = stripHtml(bodyHtml);
    if (subject.includes('CANCELLAZIONE') || txt.includes('*CANCELLATO*')) result.cancellato = true;
    const numMatch = txt.match(/Numero\s*[Pp]renotazione:?\s*(\d+)/i) || subject.match(/#(\d{5})/);
    if (numMatch) result.numero = numMatch[1];
    
    // Estrazione Costo Totale e Extra
    const costoMatch = txt.match(/Costo Totale:\s*€?\s*(\d+[.,]?\d*)/i);
    if (costoMatch) result.emailCostoTotale = parseFloat(costoMatch[1].replace(',', '.'));
    
    // Cerca pattern extra: "+ 3€" o similia
    const extraMatch = txt.match(/\+\s*(\d+[.,]?\d*)\s*€/i) || txt.match(/extra\s*€?\s*(\d+[.,]?\d*)/i);
    if (extraMatch) result.emailExtra = parseFloat(extraMatch[1].replace(',', '.'));

    const nomeMatch = txt.match(/Nome del cliente:\s*(.*?)(?:\n|$)/i);
    if (nomeMatch) result.nomeCliente = nomeMatch[1].trim();
    const sedeMatch = subject.match(/Fast\s*[Cc]ar\s*-\s*([^0-9\-]+?)(?:\s*\d+\s*-|\s*-)/i);
    if (sedeMatch) result.sedeName = sedeMatch[1].trim();
    const servMatch = txt.match(/Servizio:\s*(.*?)(?=TARGA|Nome|Data|CASA|Costo|$)/is);
    if (servMatch) result.servizio = servMatch[1].trim();
    
    const dataMatch = txt.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dataMatch) result.dataTrattamento = dataMatch[1];

    return result;
}

async function fetchEmailsFromImap(startDate, endDate) {
    let connection;
    const results = [];
    try {
        connection = await imaps.connect(imapConfig);
        await connection.openBox('INBOX');
        const formatImapDate = (date) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
        };
        
        const startStr = formatImapDate(startDate);
        let searchCriteria;
        
        if (endDate && endDate.toDateString() !== startDate.toDateString()) {
             // Se c'è un range (es. mensile/settimanale), usa SINCE e BEFORE strigente
             const endObj = new Date(endDate.getTime() + 86400000); // Giorno successivo per includere tutto il fine giorno
             searchCriteria = [['SINCE', startStr], ['BEFORE', formatImapDate(endObj)]];
        } else {
             // Giorno singolo
             searchCriteria = [['ON', startStr]];
        }

        const fetchOptions = { bodies: [''], markSeen: false };
        const allMessages = await connection.search(searchCriteria, fetchOptions);
        for (const item of allMessages) {
            const allParts = item.parts.find(p => p.which === '');
            if (!allParts) continue;
            const parsed = await simpleParser(allParts.body);
            
            const booking = parseEmailData(parsed.subject || '', parsed.text || stripHtml(parsed.html || ''));
            if (booking.numero) results.push(booking);
        }
    } catch (err) { console.error('❌ [IMAP] Errore:', err); }
    finally { if (connection) connection.end(); }
    return results;
}

// ============================================================
// 3. MERGE DEI DATI E GENERAZIONE REPORT
// ============================================================
const ALL_POINTS = [
    'FastCar - Ciamarra', 'FastCar - Primavalle', 'FastCar - Colli Portuensi', 'FastCar - Tivoli', 
    'FastCar - Arco di Travertino', 'FastCar - Granai', 'FastCar - San Paolo', 'FastCar - Casilino', 
    'FastCar - Monteverde', 'Centro Revisioni Colli', 'Centro Revisioni Tiburtino', 'FastCar - Fonte Nuova', 
    'FastCar - Palidoro', 'FastCar - Trieste'
];

async function generateHybridData(startDate, endDate) {
    console.log(`[HYBRID] Processing Arrivals only (Email driven) for: ${startDate.toLocaleDateString()}`);

    // FETCH EMAIL (Fonte primaria esclusiva per "Arrivate")
    const emails = await fetchEmailsFromImap(startDate, endDate);

    // Raggruppamento per ID (numero prenotazione) per eliminare doppioni e applicare le cancellazioni
    const bookingMap = new Map();

    for (const e of emails) {
        if (!e.numero) continue;
        const exist = bookingMap.get(e.numero);
        
        if (!exist) {
            // Primo inserimento
            bookingMap.set(e.numero, e);
        } else {
            // Se esiste già, aggiorniamo solo se la nuova email porta informazioni di cancellazione 
            // o se è una nuova prenotazione ma avevamo una versione senza dati di costo
            if (e.cancellato) {
                exist.cancellato = true;
            } else if (!exist.emailCostoTotale && e.emailCostoTotale) {
                // Sostituiamo il placeholder con la versione ricca di dati se trovata in un doppione
                bookingMap.set(e.numero, e);
            }
        }
    }

    const uniqueEmails = Array.from(bookingMap.values());

    // Le "arrivate" valide sono quelle non cancellate e con un servizio specificato
    const arrivateEmails = uniqueEmails.filter(e => !e.cancellato && (e.servizio || '').length > 0);
    // Le "cancellate" sono quelle che hanno ricevuto l'email di disdetta
    const cancellateEmails = uniqueEmails.filter(e => e.cancellato);

    const stats = {
        totale: arrivateEmails.length,
        cancellate: cancellateEmails.length,
        incasso: arrivateEmails.reduce((acc, e) => acc + (e.emailCostoTotale || 0), 0),
        extra: arrivateEmails.reduce((acc, e) => acc + (e.emailExtra || 0), 0),
        perSede: {},
        perGenere: { Uomo: 0, Donna: 0, 'Non specificato': 0 },
        perServizio: {},
        proprie: arrivateEmails.filter(e => isSedePropria(e.sedeName)).length,
        autorizzate: arrivateEmails.filter(e => !isSedePropria(e.sedeName)).length
    };

    arrivateEmails.forEach(e => {
        const s = e.sedeName || 'Altro';
        stats.perSede[s] = (stats.perSede[s] || 0) + 1;
        stats.perGenere[detectGenere(e.nomeCliente)]++;
        const serv = simplifyServizio(e.servizio);
        stats.perServizio[serv] = (stats.perServizio[serv] || 0) + 1;
    });

    return {
        ricevute: stats
    };
}

function buildHybridReportText(type, data, priorData = null, startDate = null) {
    const r = data.ricevute;
    const extraPct = r.incasso > 0 ? ((r.extra / r.incasso) * 100).toFixed(0) : "0";
    const media = r.totale > 0 ? (r.incasso / r.totale).toFixed(2) : "0.00";
    const propriaPct = r.totale > 0 ? ((r.proprie / r.totale) * 100).toFixed(0) : "0";
    const autPct = r.totale > 0 ? ((r.autorizzate / r.totale) * 100).toFixed(0) : "0";
    
    // Calcolo percentuale NO SHOW sul totale delle richieste (arrivate + cancellate)
    const totRichieste = r.totale + r.cancellate;
    const noShowPct = totRichieste > 0 ? ((r.cancellate / totRichieste) * 100).toFixed(0) : "0";

    let label = 'DI OGGI';
    if (type === 'weekly') label = 'SETTIMANALE';
    if (type === 'chiusura') label = 'DI FINE GIORNATA';
    if (type === 'monthly') {
        const mesi = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
        const meseNome = startDate ? mesi[new Date(startDate).getMonth()] : '';
        label = `MENSILE di ${meseNome}`;
    }

    let text = "";
    if (type === 'chiusura') {
        text = `Ecco il RIEPILOGO DI CHIUSURA DI FINE GIORNATA FAST CAR. `;
        text += `Oggi abbiamo totalizzato ${r.totale} lavorazioni valide. `;
    } else {
        text = `Ecco il resoconto ${label} DELLE PRENOTAZIONI SUL PORTALE FAST CAR PUNTO I T. `;
        text += `Abbiamo ricevuto ${r.totale} nuove prenotazioni complessive. `;
    }
    
    if (priorData && priorData.ricevute) {
        const pr = priorData.ricevute;
        const diffTot = r.totale - pr.totale;
        const pctTot = pr.totale > 0 ? ((diffTot / pr.totale) * 100).toFixed(0) : "0";
        const growthDir = diffTot >= 0 ? "una crescita" : "una flessione";
        text += `Rispetto al periodo precedente, registriamo ${growthDir} del ${Math.abs(pctTot)} percento nel numero di prenotazioni. `;
    }

    text += `Il volume d'affari stimato per questi nuovi arrivi è di ${r.incasso.toFixed(2)} euro, di cui extra equivale a ${r.extra.toFixed(2)} euro, per una percentuale del ${extraPct} percento. `;
    
    if (priorData && priorData.ricevute) {
        const pr = priorData.ricevute;
        const diffInc = r.incasso - pr.incasso;
        const pctInc = pr.incasso > 0 ? ((diffInc / pr.incasso) * 100).toFixed(0) : "0";
        const growthIncDir = diffInc >= 0 ? "un incremento" : "un calo";
        text += `Il volume d'affari mostra ${growthIncDir} del ${Math.abs(pctInc)} percento rispetto al mese scorso. `;
    }

    text += `Con una media di ${media} euro a prenotazione. `;
    text += `Abbiamo ricevuto anche ${r.cancellate} NO SHOW, pari al ${noShowPct} percento del totale delle richieste. `;
    text += `Il ${propriaPct} percento delle prenotazioni sono arrivate sui nostri Point, con ${r.proprie} prenotazioni, e sui autorizzati ${r.autorizzate}, pari al ${autPct} percento. `;
    
    text += `Ecco la suddivisione per sede: `;
    const sedi = Object.entries(r.perSede).sort((a,b) => b[1] - a[1]);
    text += sedi.map(([name, count]) => `${count} a ${name}`).join(', ') + '. ';

    text += `La clientela è composta da ${r.perGenere.Uomo} uomini e ${r.perGenere.Donna} donne. `;
    
    // Aggiunta elenco lavorazioni
    if (Object.keys(r.perServizio).length > 0) {
        text += `Ecco infine il dettaglio delle tipologie di lavorazioni richieste: `;
        const servizi = Object.entries(r.perServizio).sort((a,b) => b[1] - a[1]);
        text += servizi.map(([name, count]) => `${count} ${name}`).join(', ') + '. ';
    }

    text += `Buon lavoro A TUTTI!`;

    return text;
}

async function getVoiceReport(config = new Date(), customFilename = null) {
    try {
        let textToSpeak = '', type = 'daily', outputPath = '';
        if (typeof config === 'string') {
            textToSpeak = config;
            outputPath = (customFilename && path.isAbsolute(customFilename)) ? customFilename : path.join(__dirname, customFilename || 'vocale_custom.mp3');
        } else {
            if (config instanceof Date || !config.type) config = { type: 'daily', targetDate: config instanceof Date ? config : new Date() };
            type = config.type;
            const start = config.startDate || config.targetDate;
            const end = config.endDate || config.targetDate;
            
            const data = await generateHybridData(start, end);
            
            let priorData = null;
            if (config.priorStartDate && config.priorEndDate) {
                console.log(`[Hybrid] Recupero dati confronto per periodo precedente...`);
                priorData = await generateHybridData(config.priorStartDate, config.priorEndDate);
            }
            
            textToSpeak = buildHybridReportText(type, data, priorData, start);
            outputPath = (customFilename && path.isAbsolute(customFilename)) ? customFilename : path.join(__dirname, customFilename || `vocale_hybrid_${type}.mp3`);
        }

        console.log(`[Hybrid] Generazione audio su: ${path.basename(outputPath)}`);
        const tts = new MsEdgeTTS();
        await tts.setMetadata('it-IT-ElsaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(textToSpeak, { rate: '+25%' });
        await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(outputPath);
            audioStream.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        tts.close();
        return { audioPath: outputPath, text: textToSpeak };
    } catch (error) { console.error('❌ Errore Hybrid Agent:', error); throw error; }
}

module.exports = { getVoiceReport, generateHybridData };
