const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const logger = require('./src/utils/logger');
const Database = require('./src/models/database');
const AuthService = require('./src/services/authService');
const CalendarService = require('./src/services/calendarService');
const MessageHandler = require('./src/modules/messageHandler');
const NLPProcessor = require('./src/utils/nlpProcessor');

class WhatsAppProductivityBot {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.whatsappClient = null;
        this.database = null;
        this.messageHandler = null;
        this.currentQR = null;
        this.isReady = false;
        this.lastError = null;
        
        this.setupExpress();
        this.initializeDatabase();
        this.initializeWhatsApp();
    }

    setupExpress() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                whatsapp: this.isReady ? 'ready' : this.currentQR ? 'waiting_for_scan' : 'initializing'
            });
        });

        // QR Code image endpoint
        this.app.get('/qr-image', (req, res) => {
            if (this.currentQR) {
                const QRCode = require('qrcode');
                QRCode.toBuffer(this.currentQR, { width: 300, margin: 2 }, (err, buffer) => {
                    if (err) {
                        res.status(500).send('Error generating QR code');
                    } else {
                        res.set('Content-Type', 'image/png');
                        res.send(buffer);
                    }
                });
            } else {
                res.status(404).send('QR code not available');
            }
        });

        // Simple QR Code display endpoint - BULLETPROOF VERSION
        this.app.get('/qr', (req, res) => {
            if (this.isReady) {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>✅ Bot Ready</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #4CAF50; color: white; }
                            h1 { font-size: 3em; margin: 20px 0; }
                        </style>
                    </head>
                    <body>
                        <h1>✅</h1>
                        <h2>WhatsApp Bot is READY!</h2>
                        <p>Send messages on WhatsApp now</p>
                    </body>
                    </html>
                `);
            } else if (this.currentQR) {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>📱 Scan QR Code</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f0f0f0; }
                            .container { background: white; padding: 30px; border-radius: 15px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                            .qr-img { max-width: 100%; height: auto; border: 3px solid #25D366; border-radius: 10px; }
                            h1 { color: #25D366; margin-bottom: 20px; }
                            .instructions { background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; font-size: 14px; }
                            .refresh { background: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
                        </style>
                        <script>
                            setTimeout(() => window.location.reload(), 45000); // Refresh every 45 seconds
                        </script>
                    </head>
                    <body>
                        <div class="container">
                            <h1>📱 Scan QR Code</h1>
                            
                            <!-- DIRECT IMAGE - NO JAVASCRIPT NEEDED -->
                            <img src="/qr-image?t=${Date.now()}" alt="WhatsApp QR Code" class="qr-img" />
                            
                            <div class="instructions">
                                <strong>📋 Steps:</strong><br>
                                1. Open WhatsApp<br>
                                2. Settings → Linked Devices<br>
                                3. "Link a Device"<br>
                                4. Scan above QR code
                            </div>
                            
                            <a href="/qr" class="refresh">🔄 Get New QR</a>
                        </div>
                    </body>
                    </html>
                `);
            } else {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>🔄 Starting Bot...</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #ff9800; color: white; }
                            .spinner { border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid white; border-radius: 50%; width: 60px; height: 60px; animation: spin 1s linear infinite; margin: 20px auto; }
                            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                        </style>
                        <script>
                            setTimeout(() => window.location.reload(), 10000); // Refresh every 10 seconds
                        </script>
                    </head>
                    <body>
                        <div class="spinner"></div>
                        <h2>🔄 Bot Starting...</h2>
                        <p>Please wait, will refresh automatically</p>
                    </body>
                    </html>
                `);
            }
        });

        // Debug endpoint to check OAuth config
        this.app.get('/debug-oauth', (req, res) => {
            res.json({
                redirect_uri: process.env.GOOGLE_REDIRECT_URI,
                client_id: process.env.GOOGLE_CLIENT_ID,
                node_env: process.env.NODE_ENV
            });
        });

        // Error log viewer endpoint
        this.app.get('/errors', (req, res) => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Bot Error Logs</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                        .container { background: white; padding: 20px; border-radius: 10px; max-width: 800px; margin: 0 auto; }
                        .error { background: #ffe6e6; border: 1px solid #ff9999; padding: 10px; margin: 10px 0; border-radius: 5px; }
                        .timestamp { color: #666; font-size: 0.9em; }
                        .refresh { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
                        pre { background: #f8f9fa; padding: 10px; border-radius: 3px; overflow-x: auto; }
                    </style>
                    <script>
                        // Auto-refresh every 10 seconds
                        setTimeout(() => { window.location.reload(); }, 10000);
                    </script>
                </head>
                <body>
                    <div class="container">
                        <h2>🔍 Bot Error Logs</h2>
                        <p>Last updated: ${new Date().toLocaleString()}</p>
                        <a href="/errors" class="refresh">🔄 Refresh</a>
                        
                        <div id="errors">
                            ${this.lastError ? `
                                <div class="error">
                                    <div class="timestamp">Latest Error: ${new Date().toLocaleString()}</div>
                                    <strong>Message:</strong> ${this.lastError.message}<br>
                                    <strong>Stack:</strong><br>
                                    <pre>${this.lastError.stack}</pre>
                                </div>
                            ` : '<p><em>No recent errors. Try the auth process again.</em></p>'}
                        </div>
                        
                        <h3>📊 Debug Info:</h3>
                        <pre>
Redirect URI: ${process.env.GOOGLE_REDIRECT_URI}
Node ENV: ${process.env.NODE_ENV}
JWT Secret Set: ${process.env.JWT_SECRET ? 'Yes' : 'No'}
Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing'}
                        </pre>
                    </div>
                </body>
                </html>
            `);
        });

        // Google OAuth callback
        this.app.get('/auth/google/callback', async (req, res) => {
            try {
                const { code, state } = req.query;
                const authService = new AuthService(this.database);
                await authService.handleGoogleCallback(code, state);
                
                // If running locally, redirect back to localhost notification
                if (process.env.NODE_ENV === 'development') {
                    res.send(`
                        <html>
                        <head><title>Auth Success</title></head>
                        <body style="font-family: Arial; text-align: center; padding: 50px;">
                            <h2>✅ Authorization Successful!</h2>
                            <p>Your Google Calendar is now connected!</p>
                            <p>🔄 Go back to your WhatsApp chat and try scheduling an event.</p>
                            <p><strong>You can close this window.</strong></p>
                        </body>
                        </html>
                    `);
                } else {
                    res.send('Authorization successful! You can now use the bot.');
                }
            } catch (error) {
                this.lastError = error; // Store for error viewer
                logger.error('Google auth callback error:', error);
                res.status(500).send(`
                    <html>
                    <head><title>Auth Failed</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>❌ Authorization Failed</h2>
                        <p><strong>Error:</strong> ${error.message}</p>
                        <p>Please try again by saying "connect google" in WhatsApp.</p>
                        <details style="text-align: left; max-width: 600px; margin: 20px auto;">
                            <summary>Technical Details</summary>
                            <pre>${error.stack}</pre>
                        </details>
                    </body>
                    </html>
                `);
            }
        });
    }

    async initializeDatabase() {
        try {
            this.database = new Database();
            await this.database.initialize();
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            process.exit(1);
        }
    }

    initializeWhatsApp() {
        logger.info('Initializing WhatsApp client...');
        
        this.whatsappClient = new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--memory-pressure-off'
                ],
                timeout: 120000,
                handleSIGINT: false,
                handleSIGTERM: false
            }
        });

        logger.info('WhatsApp client created, setting up event listeners...');

        this.whatsappClient.on('loading_screen', (percent, message) => {
            logger.info(`WhatsApp loading: ${percent}% - ${message}`);
        });

        this.whatsappClient.on('qr', (qr) => {
            this.currentQR = qr;
            this.isReady = false;
            const qrUrl = process.env.NODE_ENV === 'production' ? 'https://bots-hid0.onrender.com/qr' : 'http://localhost:3000/qr';
            logger.info(`QR Code received! Go to ${qrUrl} to scan it`);
            console.log('\n📱 QR CODE READY!');
            console.log(`🌐 Open in browser: ${qrUrl}`);
            console.log('📱 Then scan with your WhatsApp app\n');
        });

        this.whatsappClient.on('ready', () => {
            this.currentQR = null;
            this.isReady = true;
            logger.info('WhatsApp client is ready!');
            console.log('\n✅ WhatsApp Bot is now READY!');
            console.log('📱 You can now send messages to the bot on WhatsApp\n');
            
            this.messageHandler = new MessageHandler(
                this.whatsappClient, 
                this.database
            );
        });

        this.whatsappClient.on('authenticated', () => {
            logger.info('WhatsApp client authenticated');
        });

        this.whatsappClient.on('auth_failure', (msg) => {
            logger.error('WhatsApp authentication failed:', msg);
        });

        this.whatsappClient.on('disconnected', (reason) => {
            logger.warn('WhatsApp client disconnected:', reason);
        });

        this.whatsappClient.on('message', async (message) => {
            if (this.messageHandler) {
                await this.messageHandler.handleMessage(message);
            }
        });

        logger.info('Starting WhatsApp client initialization...');
        this.whatsappClient.initialize().catch(error => {
            logger.error('WhatsApp client initialization failed:', error);
        });
    }

    start() {
        this.app.listen(this.port, () => {
            logger.info(`Server running on port ${this.port}`);
        });
    }

    async shutdown() {
        logger.info('Shutting down bot...');
        
        if (this.whatsappClient) {
            await this.whatsappClient.destroy();
        }
        
        if (this.database) {
            await this.database.close();
        }
        
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    if (global.bot) {
        await global.bot.shutdown();
    }
});

process.on('SIGTERM', async () => {
    if (global.bot) {
        await global.bot.shutdown();
    }
});

// Start the bot
const bot = new WhatsAppProductivityBot();
global.bot = bot;
bot.start();

module.exports = WhatsAppProductivityBot;
