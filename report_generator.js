require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { MsEdgeTTS } = require('msedge-tts');
const { OUTPUT_FORMAT } = require('msedge-tts/dist/Output');

// ============================================================
// CONFIGURAZIONE
// ============================================================
// I TUOI punti vendita (propri)
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
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/┬á/g, ' ').replace(/Ôé¼/g, '€').trim();
}

function isSedePropria(sedeName) {
  if (!sedeName) return false;
  const sedeNorm = sedeName.toLowerCase();
  return SEDI_PROPRIE.some(s => sedeNorm.includes(s.toLowerCase()));
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
  
  const femminili = ['maria','anna','giulia','francesca','sara','laura','valentina','alessia','chiara','elena',
    'silvia','paola','daniela','barbara','simona','monica','cristina','claudia','roberta','federica',
    'martina','elisa','ilaria','manuela','patrizia','rosa','giovanna','antonella','luca','carla','angela',
    'alessandra','sabrina','eleonora','serena','veronica','rachele','beatrice','arianna','miriam',
    'irene','nadia','luisa','teresa','stefania','cinzia','marta','elisabetta','sonia','tiziana',
    'giorgia','jessica','noemi','aurora','greta','camilla','alice','flavia','michela','lucia',
    'viviana','lorena','ornella','katia','fabiana','liliana','emma','sofia','bianca','adele'];
  
  const maschili = ['marco','luca','andrea','giuseppe','giovanni','antonio','francesco','alessandro',
    'matteo','lorenzo','stefano','roberto','paolo','michele','davide','fabio','massimo','daniele',
    'alberto','simone','federico','riccardo','claudio','giorgio','vincenzo','nicola','emanuele',
    'tommaso','filippo','carlo','gabriele','enrico','salvatore','mario','bruno','sergio','franco',
    'maurizio','pierpaolo','gianluca','luigì','pietro','angelo','raffaele','valerio',
    'christian','manuel','edoardo','samuele','diego','leonardo'];
  
  if (femminili.includes(nome)) return 'Donna';
  if (maschili.includes(nome)) return 'Uomo';
  if (nome.endsWith('a') && !['luca','andrea','nicola'].includes(nome)) return 'Donna';
  return 'Uomo';
}

// ============================================================
// PARSING EMAIL
// ============================================================
function parseBookingData(subject, bodyHtml) {
  const result = {
    numero: null, sedeName: null, servizio: null, data: null, orario: null,
    costoTotale: null, costoServizio: 0, costoAggiunti: 0,
    nomeCliente: null, cancellato: false,
    targa: null, marca: null, modello: null, genere: null, tipoSede: null
  };
  
  const txt = stripHtml(bodyHtml);
  
  // Cancellazione (subject o body)
  if (subject.includes('CANCELLAZIONE') || txt.includes('*CANCELLATO*')) result.cancellato = true;
  
  // Sede dal subject
  const sedeMatch = subject.match(/Fast\s*[Cc]ar\s*-\s*([^0-9\-]+?)(?:\s*\d+\s*-|\s*-)/i);
  if (sedeMatch) result.sedeName = sedeMatch[1].trim();
  
  // Numero prenotazione
  const numMatch = txt.match(/Numero\s*[Pp]renotazione:?\s*(\d+)/i);
  if (numMatch) result.numero = numMatch[1];
  
  // Servizio
  const servizioMatch = txt.match(/Servizio:\s*(.*?)(?=TARGA|Nome|Data|CASA|Costo|$)/is);
  if (servizioMatch) result.servizio = servizioMatch[1].trim();
  
  // Data
  const dataMatch = txt.match(/Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (dataMatch) result.data = dataMatch[1];
  
  // Orario
  const orarioMatch = txt.match(/Orario:\s*(\d{2}:\d{2})/i);
  if (orarioMatch) result.orario = orarioMatch[1];
  
  // Costo Totale
  const costoMatch = txt.match(/Costo Totale:\s*(.*?)(?=\n|Nome|A presto|$)/is);
  if (costoMatch) result.costoTotale = costoMatch[1].trim();
  
  // Prezzo servizio principale (dal campo Servizio, es: "Tagliando - Auto ... (€169)")
  if (result.servizio) {
    const prezzoMatch = result.servizio.match(/[€]\s*(\d+[.,]?\d*)/);
    if (prezzoMatch) {
      result.costoServizio = parseFloat(prezzoMatch[1].replace(',', '.'));
    }
  }
  
  // Calcolo valore aggiunto: totale - servizio principale
  if (result.costoTotale && result.costoServizio > 0) {
    const totMatch = result.costoTotale.match(/€?\s*(\d+[.,]?\d*)/);
    if (totMatch) {
      const totale = parseFloat(totMatch[1].replace(',', '.'));
      result.costoAggiunti = Math.max(0, totale - result.costoServizio);
    }
  } else if (result.costoTotale) {
    const totMatch = result.costoTotale.match(/€?\s*(\d+[.,]?\d*)/);
    if (totMatch) {
      result.costoServizio = parseFloat(totMatch[1].replace(',', '.'));
      result.costoAggiunti = 0;
    }
  }
  
  // Nome cliente
  const nomeMatch = txt.match(/Nome del cliente:\s*(.*?)(?:\n|$)/i);
  if (nomeMatch) result.nomeCliente = nomeMatch[1].trim();
  
  // Targa
  const targaMatch = txt.match(/TARGA:\s*([A-Z0-9]+)/i);
  if (targaMatch) result.targa = targaMatch[1].toUpperCase();
  
  // Marca
  const marcaMatch = txt.match(/(?:CASA DELLA VETTURA|MARCA):\s*(.*?)(?:\n|$)/i);
  if (marcaMatch) result.marca = marcaMatch[1].trim();
  
  // Modello
  const modelloMatch = txt.match(/MODELLO:\s*(.*?)(?:\n|$)/i);
  if (modelloMatch) result.modello = modelloMatch[1].trim();
  
  result.genere = detectGenere(result.nomeCliente);
  result.tipoSede = isSedePropria(result.sedeName) ? 'Propria' : 'Autorizzata';
  
  return result;
}

// ============================================================
// FETCH EMAIL TRAMITE IMAP
// ============================================================
async function fetchEmailsFromImap(startDate, endDate) {
  let connection;
  const results = [];
  try {
    console.log('[IMAP] Connessione al server...');
    connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    const formatImapDate = (date) => {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
    };

    const startStr = formatImapDate(startDate);
    
    let searchPrenotazioni, searchCancellazioni;
    if (endDate && endDate.toDateString() !== startDate.toDateString()) {
      const endPlusOne = new Date(endDate);
      endPlusOne.setDate(endPlusOne.getDate() + 1);
      const endStr = formatImapDate(endPlusOne);
      console.log(`[IMAP] Ricerca email nel range dal ${startStr} al ${formatImapDate(endDate)}...`);
      searchPrenotazioni = [['SINCE', startStr], ['BEFORE', endStr], ['SUBJECT', 'prenotazione']];
      searchCancellazioni = [['SINCE', startStr], ['BEFORE', endStr], ['SUBJECT', 'cancellazione']];
    } else {
      console.log(`[IMAP] Ricerca email del singolo giorno ${startStr}...`);
      searchPrenotazioni = [['ON', startStr], ['SUBJECT', 'prenotazione']];
      searchCancellazioni = [['ON', startStr], ['SUBJECT', 'cancellazione']];
    }
    
    const fetchOptions = { bodies: [''], markSeen: false };
    
    const msgs1 = await connection.search(searchPrenotazioni, fetchOptions);
    const msgs2 = await connection.search(searchCancellazioni, fetchOptions);
    const allMessages = [...msgs1, ...msgs2];
    
    console.log(`[IMAP] Trovate ${allMessages.length} email rilevanti. Elaborazione in corso...`);

    for (const item of allMessages) {
      const allParts = item.parts.find(p => p.which === '');
      if (!allParts) continue;
      
      const parsed = await simpleParser(allParts.body);
      const subject = parsed.subject || '';
      const bodyHtml = parsed.html || parsed.textAsHtml || parsed.text || '';
      
      const booking = parseBookingData(subject, bodyHtml);
      if (booking.numero) {
        // Double check date matching locally per non incappare in differenze fusi orario IMAP estreme
        let include = true;
        if (booking.data) {
           const [dd, mm, yyyy] = booking.data.split('/');
           const bDate = new Date(yyyy, mm - 1, dd);
           if (endDate) {
              const startCheck = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
              const endCheck = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59);
              if (bDate < startCheck || bDate > endCheck) include = false;
           } else {
              if (bDate.getDate() !== startDate.getDate() || bDate.getMonth() !== startDate.getMonth()) include = false;
           }
        }
        if (include) results.push(booking);
      }
    }

  } catch (err) {
    console.error('❌ [IMAP] Errore:', err);
  } finally {
    if (connection) connection.end();
  }
  return results;
}

// ============================================================
// GENERAZIONE DATI REPORT
// ============================================================
async function generateBookingData(startDate, endDate) {
  const allBookings = await fetchEmailsFromImap(startDate, endDate);
  
  const uniqueBookings = {};
  allBookings.forEach(b => {
    // Per gestire il "doppio slot" (stesso ID prenotazione ma due clienti diversi in parallelo), usiamo chiave composita
    let key;
    if (b.numero && b.nomeCliente) key = `${b.numero}_${b.nomeCliente}`;
    else if (b.numero) key = b.numero;
    else key = Math.random().toString();
    
    uniqueBookings[key] = b;
  });
  
  const finalBookings = Object.values(uniqueBookings);
  const nuove = finalBookings.filter(b => !b.cancellato);
  const cancellate = finalBookings.filter(b => b.cancellato);
  
  let totaleIncasso = 0;
  nuove.forEach(b => {
    if (b.costoTotale) {
      const match = b.costoTotale.match(/€?\s*(\d+[.,]?\d*)/);
      if (match) totaleIncasso += parseFloat(match[1].replace(',', '.'));
    }
  });

  let perditaCancellazioni = 0;
  cancellate.forEach(b => {
    if (b.costoTotale) {
      const match = b.costoTotale.match(/€?\s*(\d+[.,]?\d*)/);
      if (match) perditaCancellazioni += parseFloat(match[1].replace(',', '.'));
    }
  });

  const perSede = {};
  nuove.forEach(b => {
    const sede = b.sedeName || 'Sede non specificata';
    if (!perSede[sede]) perSede[sede] = [];
    perSede[sede].push(b);
  });

  const proprie = nuove.filter(b => b.tipoSede === 'Propria');
  const autorizzate = nuove.filter(b => b.tipoSede === 'Autorizzata');
  
  const perGenere = { Uomo: 0, Donna: 0, 'Non specificato': 0 };
  nuove.forEach(b => {
    perGenere[b.genere] = (perGenere[b.genere] || 0) + 1;
  });

  const perServizio = {};
  nuove.forEach(b => {
    const servizio = simplifyServizio(b.servizio);
    perServizio[servizio] = (perServizio[servizio] || 0) + 1;
  });
  
  return {
    totale: nuove.length,
    cancellate: cancellate.length,
    incasso: totaleIncasso.toFixed(2),
    incassoServizi: nuove.reduce((s,b) => s + b.costoServizio, 0).toFixed(2),
    incassoAggiunti: nuove.reduce((s,b) => s + b.costoAggiunti, 0).toFixed(2),
    perditaCancellazioni: perditaCancellazioni.toFixed(2),
    perSede,
    proprie: proprie.length,
    autorizzate: autorizzate.length,
    perGenere,
    perServizio,
    rawList: finalBookings
  };
}

// ============================================================
// GENERAZIONE TESTO REPORT VOCALE
// ============================================================
function buildReportText(data) {
  let text = `Ciao! Ecco il resoconto giornaliero delle prenotazioni Fast Car. `;
  
  if (data.totale === 0 && data.cancellate === 0) {
    text += `Oggi non ci sono state né prenotazioni né cancellazioni. Ci riposiamo! A domani!`;
    return text;
  }
  
  text += `Oggi hai ricevuto un totale di ${data.totale} nuove prenotazioni`;
  if (data.cancellate > 0) {
    const pct = ((data.cancellate / (data.totale + data.cancellate)) * 100).toFixed(1);
    text += ` e subìto ${data.cancellate} cancellazioni (pari a un tasso di defezione del ${pct} percento)`;
  }
  text += `. L'incasso stimato della giornata è di ${data.incasso} euro, di cui ${data.incassoServizi} euro per i servizi principali e ${data.incassoAggiunti} euro di servizi aggiuntivi. `;
  
  text += `Delle prenotazioni, ${data.proprie} sono nelle tue officine e ${data.autorizzate} negli autorizzati. `;
  
  const sediKeys = Object.keys(data.perSede);
  const sediProprie = sediKeys.filter(s => isSedePropria(s));
  const sediAutorizzate = sediKeys.filter(s => !isSedePropria(s));
  
  if (sediProprie.length > 0) {
    text += `Nelle tue officine: `;
    text += sediProprie.map(s => `${data.perSede[s].length} a ${s}`).join(', ') + '. ';
  }
  if (sediAutorizzate.length > 0) {
    text += `Negli autorizzati: `;
    text += sediAutorizzate.map(s => `${data.perSede[s].length} a ${s}`).join(', ') + '. ';
  }
  
  if (data.perGenere.Donna > 0 || data.perGenere.Uomo > 0) {
    text += `Per quanto riguarda i clienti: ${data.perGenere.Uomo} uomini e ${data.perGenere.Donna} donne. `;
  }
  
  const servizi = Object.entries(data.perServizio).sort((a, b) => b[1] - a[1]);
  if (servizi.length > 0) {
    text += `I servizi più richiesti: `;
    const top3 = servizi.slice(0, 3).map(([s, c]) => `${s} con ${c} prenotazioni`);
    text += top3.join(', ') + '. ';
  }
  
  text += `Ottimo lavoro per oggi, a presto!`;
  return text;
}

// ============================================================
// TESTI MENSILI E SETTIMANALI
// ============================================================

function buildWeeklyReportText(data) {
  let text = `Ciao Fabio! Ecco il resoconto aggregato di tutta l'ultima settimana. `;
  
  if (data.totale === 0 && data.cancellate === 0) {
    text += `Questa settimana non ci sono state registrazioni. Buon proseguimento!`;
    return text;
  }
  if (data.cancellate > 0) {
    const pct = ((data.cancellate / (data.totale + data.cancellate)) * 100).toFixed(1);
    text += `Negli ultimi sette giorni abbiamo elaborato un totale di ${data.totale} nuove prenotazioni. Abbiamo subìto ${data.cancellate} cancellazioni, pari a un tasso di defezione del ${pct} percento sulla mole di lavoro richiesta. `;
  } else {
    text += `Negli ultimi sette giorni abbiamo elaborato un totale di ${data.totale} nuove prenotazioni e nessuna cancellazione. `;
  }
  text += `L'incasso totale stimato della settimana è di ${data.incasso} euro, di cui ${data.incassoServizi} per i servizi principali e ${data.incassoAggiunti} euro di servizi aggiuntivi. `;
  
  text += `Siamo a quota ${data.proprie} appuntamenti nelle officine proprie, e ${data.autorizzate} negli autorizzati. `;
  
  const servizi = Object.entries(data.perServizio).sort((a, b) => b[1] - a[1]);
  if (servizi.length > 0) {
    text += `Il servizio di punta della settimana è stato ${servizi[0][0]} con ${servizi[0][1]} lavorazioni. `;
  }
  
  text += `Ottima settimana, avanti così verso l'obiettivo!`;
  return text;
}

function buildMonthlyReportText(data, priorData) {
  let text = `Ciao Fabio! È il primo del mese e questo è il momento del grande resoconto mensile cumulativo. `;
  
  if (data.totale === 0) {
    text += `Il mese appena concluso non ha registrato alcuna operazione dal bot. `;
    return text;
  }
  
  text += `Il mese spettacolare si è chiuso con un totale di ${data.totale} prenotazioni, rispetto alle ${priorData.totale} del mese prima. `;
  
  const pct = priorData.totale > 0 ? (((data.totale - priorData.totale) / priorData.totale) * 100).toFixed(1) : 100;
  if (data.totale >= priorData.totale) {
    text += `Abbiamo un incremento del ${pct} percento di appuntamenti! Magnifico! `;
  } else {
    text += `C'è stata una lieve flessione del ${Math.abs(pct)} percento rispetto al mese anteriore. `;
  }
  
  text += `L'incasso complessivo sviluppato in questi trenta giorni è di ben ${data.incasso} euro totali. Di questi, ${data.incassoAggiunti} euro sono frutto unicamente dei servizi aggiuntivi inseriti a sistema. `;
  
  text += `Delle ${data.totale} lavorazioni, ${data.proprie} si sono tenute nelle tue basi e ${data.autorizzate} negli esterni. `;
  if (data.cancellate > 0) {
    const pct = ((data.cancellate / (data.totale + data.cancellate)) * 100).toFixed(1);
    text += `Abbiamo subìto ${data.cancellate} rinunce (con un tasso di defezione del ${pct} percento sulle richieste totali), portando a una perdita potenziale di ${data.perditaCancellazioni} euro. `;
  }
  
  text += `Un grandissimo applauso per gli sforzi di questo mese. Puntiamo diretti a superare questo record il mese prossimo. Buon Lavoro!`;
  return text;
}

// ============================================================
// GENERAZIONE AUDIO E ORCHESTRAZIONE
// ============================================================
async function getVoiceReport(config = new Date()) {
  try {
    let type = 'daily';
    let data, priorData, textToSpeak;
    
    // Retrocompatibilità per Daily
    if (config instanceof Date || !config.type) {
        config = { type: 'daily', targetDate: config instanceof Date ? config : new Date() };
    }
    
    type = config.type;

    console.log(`[Report] Elaborazione dati dal server IMAP in modalita: ${type.toUpperCase()}...`);
    
    if (type === 'daily') {
       data = await generateBookingData(config.targetDate);
       textToSpeak = buildReportText(data);
    } else if (type === 'weekly') {
       data = await generateBookingData(config.startDate, config.endDate);
       textToSpeak = buildWeeklyReportText(data);
    } else if (type === 'monthly') {
       data = await generateBookingData(config.startDate, config.endDate);
       priorData = await generateBookingData(config.priorStartDate, config.priorEndDate);
       textToSpeak = buildMonthlyReportText(data, priorData);
    }
    
    console.log('[Report] Testo generato:', textToSpeak);
    console.log('[Report] Dettagli: Nuove=' + data.totale + ' Cancellate=' + data.cancellate +
      ' Proprie=' + data.proprie + ' Autorizzate=' + data.autorizzate);
    
    const tts = new MsEdgeTTS();
    await tts.setMetadata('it-IT-ElsaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    
    const outputPath = path.join(__dirname, 'vocale_report_oggi.mp3');
    
    console.log('[Report] Generazione audio con voce femminile ElsaNeural (1.25x)...');
    const { audioStream } = tts.toStream(textToSpeak, { rate: '+25%' });
    
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(outputPath);
      audioStream.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
      audioStream.on('error', reject);
    });
    
    tts.close();
    
    return { audioPath: outputPath, text: textToSpeak };
  } catch (error) {
    console.error('❌ Errore generazione report vocale:', error);
    throw error;
  }
}

module.exports = {
  getVoiceReport,
  generateBookingData
};
