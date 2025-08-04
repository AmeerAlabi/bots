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
                whatsapp: this.whatsappClient ? 'connected' : 'disconnected'
            });
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
            logger.info('QR Code received, scan it with your phone');
            console.log('\n📱 SCAN THIS QR CODE WITH YOUR PHONE:\n');
            qrcode.generate(qr, { small: true });
        });

        this.whatsappClient.on('ready', () => {
            logger.info('WhatsApp client is ready!');
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
