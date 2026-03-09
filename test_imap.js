require('dotenv').config({ path: 'C:/Users/bambo/Desktop/whatsapp-control/.env' });
const imaps = require('imap-simple');

const config = {
    imap: {
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASS,
        host: process.env.IMAP_HOST,
        port: parseInt(process.env.IMAP_PORT, 10),
        tls: process.env.IMAP_TLS === 'true',
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

(async () => {
    try {
        console.log('Connessione a', config.imap.host, 'con', config.imap.user, '...');
        const connection = await imaps.connect(config);
        console.log('✅ Connesso al server IMAP con successo!');
        
        await connection.openBox('INBOX');
        console.log('✅ INBOX aperta.');
        
        // Cerchiamo email delle ultime ore giusto per test
        const searchCriteria = ['UNSEEN']; // solo non lette o tutte
        const fetchOptions = { bodies: ['HEADER'], markSeen: false };
        
        // Eseguiamo una ricerca molto generica (ultime 5 email) se possibile, o passiamo oltre
        // chiudiamo test
        connection.end();
        console.log('✅ Test IMAP completato. Funziona!');
    } catch (err) {
        console.error('❌ Errore connessione IMAP:', err.message);
    }
})();
