// scripts/triggerMatcher.js
const https = require('https');

const HOST = process.env.MATCH_HOST; // ex.: SEU-APP-HEROKU.herokuapp.com
const TOKEN = process.env.CRON_TOKEN;

if (!HOST || !TOKEN) {
    console.error('Missing MATCH_HOST or CRON_TOKEN');
    process.exit(1);
}

const path = `/debug/match?token=${encodeURIComponent(TOKEN)}`;
const options = { hostname: HOST, path, method: 'GET' };

https
    .request(options, res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => {
            console.log('Status:', res.statusCode);
            console.log('Body:', data);
            process.exit(res.statusCode === 200 ? 0 : 1);
        });
    })
    .on('error', err => {
        console.error('HTTP error:', err.message);
        process.exit(1);
    })
    .end();
