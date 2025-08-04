const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class AuthService {
    constructor(database) {
        this.database = database;
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        
        this.pendingAuth = new Map(); // Temporary storage for auth states
    }

    async generateAuthUrl(phoneNumber) {
        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/userinfo.email'
        ];

        const state = jwt.sign(
            { phoneNumber, timestamp: Date.now() },
            process.env.JWT_SECRET,
            { expiresIn: '10m' }
        );

        const authUrl = this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            state: state,
            prompt: 'consent'
        });

        // Store pending auth request in memory AND database for cross-instance compatibility
        this.pendingAuth.set(phoneNumber, {
            state,
            timestamp: Date.now(),
            expires: Date.now() + (10 * 60 * 1000) // 10 minutes
        });

        // Also store in database for cross-instance access
        try {
            await this.database.run(
                'INSERT OR REPLACE INTO pending_auth (phone_number, state, expires_at) VALUES (?, ?, ?)',
                [phoneNumber, state, new Date(Date.now() + (10 * 60 * 1000)).toISOString()]
            );
            logger.info('Auth request stored in database for cross-instance access');
        } catch (dbError) {
            logger.warn('Failed to store auth in database:', dbError);
        }

        return authUrl;
    }

    async handleGoogleCallback(code, state) {
        try {
            logger.info('Google callback received', { code: code ? 'present' : 'missing', state: state ? 'present' : 'missing' });
            
            // Verify state token
            const decoded = jwt.verify(state, process.env.JWT_SECRET);
            const phoneNumber = decoded.phoneNumber;
            logger.info('State decoded successfully', { phoneNumber });

            // Check if auth request is still pending (try memory first, then database)
            let pendingRequest = this.pendingAuth.get(phoneNumber);
            
            if (!pendingRequest) {
                // Try to get from database for cross-instance compatibility
                try {
                    const dbAuth = await this.database.get(
                        'SELECT * FROM pending_auth WHERE phone_number = ? AND expires_at > datetime("now")',
                        [phoneNumber]
                    );
                    if (dbAuth) {
                        pendingRequest = { state: dbAuth.state };
                        logger.info('Found pending auth in database');
                    }
                } catch (dbError) {
                    logger.warn('Failed to check database for pending auth:', dbError);
                }
            }
            
            logger.info('Pending auth check', { 
                hasPendingRequest: !!pendingRequest, 
                stateMatch: pendingRequest?.state === state,
                pendingAuthSize: this.pendingAuth.size 
            });
            
            if (!pendingRequest || pendingRequest.state !== state) {
                logger.error('Auth request validation failed', {
                    pendingRequest: !!pendingRequest,
                    stateMatch: pendingRequest?.state === state,
                    expectedState: pendingRequest?.state,
                    receivedState: state
                });
                throw new Error('Invalid or expired auth request');
            }

            // Exchange code for tokens
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);

            // Get user info
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
            const userInfo = await oauth2.userinfo.get();

            // Update user in database
            let user = await this.database.getUserByPhone(phoneNumber);
            if (!user) {
                const result = await this.database.createUser(phoneNumber, userInfo.data.name);
                user = { id: result.id };
            }

            await this.database.updateUserAuthStatus(
                user.id,
                'authenticated',
                tokens
            );

            // Clean up pending auth
            this.pendingAuth.delete(phoneNumber);

            logger.info(`User ${phoneNumber} authenticated successfully`);
            return true;

        } catch (error) {
            logger.error('Google auth callback error:', error);
            throw error;
        }
    }

    async getAuthenticatedClient(user) {
        if (!user.google_tokens) {
            throw new Error('User not authenticated');
        }

        const tokens = JSON.parse(user.google_tokens);
        this.oauth2Client.setCredentials(tokens);

        // Check if token needs refresh
        if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
            try {
                const { credentials } = await this.oauth2Client.refreshAccessToken();
                
                // Update tokens in database
                await this.database.updateUserAuthStatus(
                    user.id,
                    'authenticated',
                    credentials
                );
                
                this.oauth2Client.setCredentials(credentials);
            } catch (error) {
                logger.error('Token refresh failed:', error);
                throw new Error('Authentication expired, please re-authenticate');
            }
        }

        return this.oauth2Client;
    }

    async revokeAccess(user) {
        try {
            if (user.google_tokens) {
                const tokens = JSON.parse(user.google_tokens);
                this.oauth2Client.setCredentials(tokens);
                await this.oauth2Client.revokeCredentials();
            }

            await this.database.updateUserAuthStatus(user.id, 'revoked', null);
            logger.info(`Access revoked for user ${user.phone_number}`);
            
        } catch (error) {
            logger.error('Error revoking access:', error);
            throw error;
        }
    }

    cleanupExpiredAuth() {
        const now = Date.now();
        for (const [phoneNumber, authData] of this.pendingAuth.entries()) {
            if (now > authData.expires) {
                this.pendingAuth.delete(phoneNumber);
                logger.info(`Cleaned up expired auth request for ${phoneNumber}`);
            }
        }
    }

    // Start cleanup interval
    startCleanupInterval() {
        setInterval(() => {
            this.cleanupExpiredAuth();
        }, 5 * 60 * 1000); // Every 5 minutes
    }
}

module.exports = AuthService;
