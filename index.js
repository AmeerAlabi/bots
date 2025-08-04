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

        // QR Code display endpoint
        this.app.get('/qr', (req, res) => {
            if (this.isReady) {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>WhatsApp Bot - Ready</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
                            .status { background: #4CAF50; color: white; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 400px; }
                        </style>
                    </head>
                    <body>
                        <div class="status">
                            <h2>✅ WhatsApp Bot is Ready!</h2>
                            <p>You can now send messages to the bot on WhatsApp.</p>
                            <p><strong>Status:</strong> Connected and Active</p>
                        </div>
                    </body>
                    </html>
                `);
            } else if (this.currentQR) {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>WhatsApp Bot - Scan QR Code</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f0f0f0; }
                            .container { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
                            .qr-code { margin: 20px 0; }
                            h1 { color: #25D366; margin-bottom: 10px; }
                            .instructions { background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; }
                            .refresh { background: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 15px; }
                        </style>
                        <script>
                            // Auto-refresh every 30 seconds
                            setTimeout(() => { window.location.reload(); }, 30000);
                        </script>
                    </head>
                    <body>
                        <div class="container">
                            <h1>📱 WhatsApp Productivity Bot</h1>
                            <p><strong>Scan this QR code with your WhatsApp:</strong></p>
                            
                            <div class="qr-code">
                                <div id="qrcode"></div>
                                <div id="qr-fallback" style="display: none;">
                                    <img src="/qr-image" alt="QR Code" style="max-width: 300px; border: 2px solid #ddd;">
                                </div>
                            </div>
                            
                            <div class="instructions">
                                <strong>📋 Instructions:</strong><br>
                                1. Open WhatsApp on your phone<br>
                                2. Go to Settings → Linked Devices<br>
                                3. Tap "Link a Device"<br>
                                4. Scan this QR code
                            </div>
                            
                            <a href="/qr" class="refresh">🔄 Refresh QR Code</a>
                        </div>
                        
                        <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
                        <script>
                            document.addEventListener('DOMContentLoaded', function() {
                                const qrData = \`${this.currentQR}\`;
                                console.log('QR Data length:', qrData.length);
                                
                                if (qrData && qrData.length > 0) {
                                    QRCode.toCanvas(document.getElementById('qrcode'), qrData, {
                                        width: 300,
                                        margin: 2,
                                        color: {
                                            dark: '#000000',
                                            light: '#FFFFFF'
                                        }
                                    }, function (error) {
                                        if (error) {
                                            console.error('QR Code generation error:', error);
                                            // Show fallback image
                                            document.getElementById('qrcode').style.display = 'none';
                                            document.getElementById('qr-fallback').style.display = 'block';
                                        } else {
                                            console.log('QR Code generated successfully');
                                        }
                                    });
                                } else {
                                    console.log('No QR data available, showing fallback');
                                    document.getElementById('qrcode').style.display = 'none';
                                    document.getElementById('qr-fallback').style.display = 'block';
                                }
                            });
                        </script>
                    </body>
                    </html>
                `);
            } else {
                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>WhatsApp Bot - Initializing</title>
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
                            .loading { background: #ff9800; color: white; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 400px; }
                            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #ff9800; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px auto; }
                            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                        </style>
                        <script>
                            // Auto-refresh every 5 seconds
                            setTimeout(() => { window.location.reload(); }, 5000);
                        </script>
                    </head>
                    <body>
                        <div class="loading">
                            <div class="spinner"></div>
                            <h2>🔄 Initializing WhatsApp Bot...</h2>
                            <p>Please wait while the bot starts up.</p>
                            <p>This page will refresh automatically.</p>
                        </div>
                    </body>
                    </html>
                `);
            }
        });

        // Google OAuth callback
        this.app.get('/auth/google/callback', async (req, res) => {
            try {
                const { code, state } = req.query;
                const authService = new AuthService(this.database);
                await authService.handleGoogleCallback(code, state);
                res.send('Authorization successful! You can now use the bot.');
            } catch (error) {
                logger.error('Google auth callback error:', error);
                res.status(500).send('Authorization failed');
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
                    '--disable-features=VizDisplayCompositor'
                ],
                timeout: 60000
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
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
