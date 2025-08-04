const logger = require('../utils/logger');
const NLPProcessor = require('../utils/nlpProcessor');
const AuthService = require('../services/authService');
const CalendarService = require('../services/calendarService');
const GeminiService = require('../services/geminiService');
const FunctionExecutor = require('../services/functionExecutor');
const { v4: uuidv4 } = require('uuid');

class MessageHandler {
    constructor(whatsappClient, database) {
        this.client = whatsappClient;
        this.database = database;
        this.nlp = new NLPProcessor();
        this.authService = new AuthService(database);
        this.calendarService = new CalendarService(database);
        this.geminiService = new GeminiService();
        this.functionExecutor = new FunctionExecutor(database);
        
        this.commands = {
            '/help': this.handleHelp.bind(this),
            '/start': this.handleStart.bind(this),
            '/auth': this.handleAuth.bind(this),
            '/status': this.handleStatus.bind(this),
            '/logout': this.handleLogout.bind(this)
        };
    }

    async handleMessage(message) {
        const startTime = Date.now();
        const phoneNumber = message.from;
        const messageText = message.body.trim();
        
        try {
            // Skip group messages, status updates, and broadcast lists
            if (message.from.includes('@g.us') || 
                message.from.includes('status@broadcast') ||
                message.from.includes('@broadcast') ||
                message.isGroupMsg === true) {
                logger.info(`Skipping group/broadcast message from: ${message.from}`);
                return;
            }

            // Only respond to individual chat messages
            if (!message.from.includes('@c.us')) {
                logger.info(`Skipping non-individual message from: ${message.from}`);
                return;
            }

            logger.info(`Received message from ${phoneNumber}: ${messageText}`);

            // Test database connection first
            try {
                await this.database.run('SELECT 1');
            } catch (dbError) {
                logger.error('Database connection test failed:', dbError);
                await this.sendMessage(phoneNumber, '🔧 Bot is temporarily unavailable. Please try again in a moment.');
                return;
            }

            // Get or create session
            const session = await this.getOrCreateSession(phoneNumber);
            if (!session) {
                await this.sendMessage(phoneNumber, '⚠️ Unable to create session. Please try:\n1. Send /start\n2. Wait a moment and try again\n3. Contact support if issue persists');
                return;
            }

            // Update session activity
            await this.database.updateSessionActivity(session.id);

            // Handle commands
            if (messageText.startsWith('/')) {
                await this.handleCommand(messageText, phoneNumber, session);
                return;
            }

            // Get user (create if doesn't exist)
            let user = await this.database.getUserByPhone(phoneNumber);
            let isNewUser = false;
            if (!user) {
                const result = await this.database.createUser(phoneNumber);
                user = { id: result.id, phone_number: phoneNumber, auth_status: 'pending' };
                isNewUser = true;
            }

            // Send welcome message for new users
            if (isNewUser) {
                await this.sendWelcomeMessage(phoneNumber);
                return;
            }

            // Check for auth keywords
            if (this.isAuthKeyword(messageText)) {
                await this.handleAuth(phoneNumber);
                return;
            }

            // Process natural language input (works with or without auth)
            await this.handleNaturalLanguageMessage(messageText, phoneNumber, session, user);

        } catch (error) {
            logger.error('Message handling error:', error);
            await this.sendMessage(phoneNumber, 'Sorry, something went wrong processing your message. Please try again.');
        } finally {
            const processingTime = Date.now() - startTime;
            
            // Log the message
            const session = await this.database.getActiveSession(phoneNumber);
            await this.database.logMessage(
                session?.id || null,
                phoneNumber,
                'incoming',
                messageText,
                null,
                processingTime,
                true
            );
        }
    }

    async getOrCreateSession(phoneNumber) {
        try {
            let session = await this.database.getActiveSession(phoneNumber);
            
            if (!session) {
                logger.info(`Creating new session for ${phoneNumber}`);
                const sessionId = uuidv4();
                const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours
                logger.info(`Expires at: ${expiresAt} (ISO: ${expiresAt.toISOString()})`);
                
                // Get or create user
                let user = await this.database.getUserByPhone(phoneNumber);
                if (!user) {
                    logger.info(`Creating new user for ${phoneNumber}`);
                    const result = await this.database.createUser(phoneNumber);
                    user = { id: result.id, phone_number: phoneNumber };
                    logger.info(`User created with ID: ${result.id}`);
                }
                
                logger.info(`Creating session ${sessionId} for user ${user.id}`);
                try {
                    await this.database.createSession(sessionId, user.id, phoneNumber, expiresAt);
                    logger.info(`Session insert completed, now fetching...`);
                    
                    session = await this.database.getActiveSession(phoneNumber);
                    logger.info(`Fetched session result:`, session);
                    
                    if (!session) {
                        logger.error(`Session was inserted but not found when fetching for ${phoneNumber}`);
                        
                        // Try to fetch ALL sessions for this phone to debug
                        const allSessions = await this.database.all('SELECT * FROM sessions WHERE phone_number = ?', [phoneNumber]);
                        logger.error(`All sessions for ${phoneNumber}:`, allSessions);
                        
                        return null;
                    }
                } catch (sessionError) {
                    logger.error(`Session creation failed for ${phoneNumber}:`, sessionError);
                    return null;
                }
                
                logger.info(`Session created successfully for ${phoneNumber}: ${session.id}`);
            } else {
                logger.info(`Using existing session for ${phoneNumber}: ${session.id}`);
            }
            
            return session;
            
        } catch (error) {
            logger.error(`Error in getOrCreateSession for ${phoneNumber}:`, error);
            return null;
        }
    }

    async handleCommand(command, phoneNumber, session) {
        const [cmd, ...args] = command.split(' ');
        
        if (this.commands[cmd]) {
            await this.commands[cmd](phoneNumber, args, session);
        } else {
            await this.sendMessage(phoneNumber, `Unknown command: ${cmd}. Type /help for available commands.`);
        }
    }

    async handleStart(phoneNumber) {
        const welcomeMessage = `
🤖 Welcome to your Productivity Assistant!

I help you manage your calendar through simple chat messages.

To get started:
1. Type /auth to authenticate with Google Calendar
2. Once authenticated, you can:
   • Schedule events: "Schedule meeting tomorrow 2pm"
   • View calendar: "What's on my calendar today?"
   • Edit events: "Move my 3pm meeting to 4pm"
   • Cancel events: "Cancel my dentist appointment"

Type /help for more commands and examples.
        `.trim();
        
        await this.sendMessage(phoneNumber, welcomeMessage);
    }

    async handleHelp(phoneNumber) {
        const helpMessage = `
📋 **Available Commands:**

**/start** - Welcome message and setup
**/auth** - Authenticate with Google Calendar
**/status** - Check your authentication status
**/logout** - Sign out and clear data
**/help** - Show this help message

🔗 **Connect Your Calendar:**
• Say **"connect google"** to link your Google Calendar
• Or use **/auth** command

⏰ **Productivity Help (No Auth Needed):**
• "How can I be more productive?"
• "Give me time management tips"
• "How do I plan my week?"
• "What is time blocking?"

📅 **Calendar Commands (After Connecting):**

**Creating Events:**
• "Schedule meeting tomorrow 2pm"
• "Book lunch with John Friday 1pm"
• "Add dentist appointment next Monday 10am"

**Viewing Events:**
• "What's on my calendar today?"
• "Show me tomorrow's schedule"
• "What's happening this week?"

**Managing Events:**
• "Move my 3pm meeting to 4pm"
• "Cancel my dentist appointment"
• "Reschedule lunch to next week"

Just type naturally and I'll understand! 🚀
        `.trim();
        
        await this.sendMessage(phoneNumber, helpMessage);
    }

    async handleAuth(phoneNumber) {
        try {
            const authUrl = await this.authService.generateAuthUrl(phoneNumber);
            
            const authMessage = `
🔐 **Authentication Required**

To use the calendar features, please:

1. Click this link: ${authUrl}
2. Sign in with your Google account
3. Grant calendar permissions
4. Come back here when done!

The link expires in 10 minutes for security.
            `.trim();
            
            await this.sendMessage(phoneNumber, authMessage);
        } catch (error) {
            logger.error('Auth URL generation error:', error);
            await this.sendMessage(phoneNumber, 'Sorry, there was an error generating the authentication link. Please try again.');
        }
    }

    async handleStatus(phoneNumber) {
        try {
            const user = await this.database.getUserByPhone(phoneNumber);
            
            if (!user) {
                await this.sendMessage(phoneNumber, '❌ No account found. Type /start to begin.');
                return;
            }

            let statusMessage = `📊 **Account Status**\n\n`;
            statusMessage += `Phone: ${phoneNumber}\n`;
            statusMessage += `Status: ${user.auth_status}\n`;
            statusMessage += `Created: ${new Date(user.created_at).toLocaleDateString()}\n`;

            if (user.auth_status === 'authenticated') {
                statusMessage += `\n✅ You're authenticated and ready to use calendar features!`;
            } else {
                statusMessage += `\n⚠️ Authentication required. Type /auth to get started.`;
            }

            await this.sendMessage(phoneNumber, statusMessage);
        } catch (error) {
            logger.error('Status check error:', error);
            await this.sendMessage(phoneNumber, 'Error checking status. Please try again.');
        }
    }

    async handleLogout(phoneNumber) {
        try {
            const user = await this.database.getUserByPhone(phoneNumber);
            if (user) {
                await this.database.updateUserAuthStatus(user.id, 'logged_out', null);
            }
            
            await this.sendMessage(phoneNumber, '👋 You have been logged out successfully. Your data has been cleared.');
        } catch (error) {
            logger.error('Logout error:', error);
            await this.sendMessage(phoneNumber, 'Error during logout. Please try again.');
        }
    }



    async handleNaturalLanguageMessage(messageText, phoneNumber, session, user) {
        try {
            // Get user context for Gemini
            const userContext = await this.buildUserContext(user);
            
            // Add auth status to context
            userContext.isAuthenticated = user.auth_status === 'authenticated';
            userContext.userMessage = messageText;
            
            // Process message with Gemini AI
            const geminiResponse = await this.geminiService.processMessage(messageText, userContext);
            
            if (geminiResponse.type === 'function_calls' && geminiResponse.functionCalls.length > 0) {
                // Execute function calls
                const functionResults = [];
                
                for (const functionCall of geminiResponse.functionCalls) {
                    try {
                        // Check if function requires authentication
                        if (this.requiresAuth(functionCall.name) && user.auth_status !== 'authenticated') {
                            functionResults.push({
                                success: false,
                                error: 'Authentication required. Please use /auth to connect your Google Calendar.',
                                function: functionCall.name,
                                requiresAuth: true
                            });
                            continue;
                        }
                        
                        // Validate function call parameters
                        const validatedParams = this.geminiService.validateFunctionCall(functionCall);
                        
                        // Execute the function
                        const result = await this.functionExecutor.executeFunctionCall({
                            name: functionCall.name,
                            args: validatedParams
                        }, user);
                        
                        functionResults.push(result);
                        
                    } catch (error) {
                        logger.error(`Function execution error for ${functionCall.name}:`, error);
                        functionResults.push({
                            success: false,
                            error: error.message,
                            function: functionCall.name
                        });
                    }
                }
                
                // Generate response based on function results
                const finalResponse = await this.geminiService.processWithFunctionResults(
                    messageText, 
                    functionResults, 
                    userContext
                );
                
                await this.sendMessage(phoneNumber, finalResponse.text);
                
            } else {
                // Direct text response from Gemini
                await this.sendMessage(phoneNumber, geminiResponse.text);
            }

        } catch (error) {
            logger.error('Gemini processing error:', error);
            
            // Fallback to original NLP processing
            try {
                await this.handleFallbackNLP(messageText, phoneNumber, user);
            } catch (fallbackError) {
                logger.error('Fallback NLP error:', fallbackError);
                await this.sendMessage(phoneNumber, 
                    'Sorry, I had trouble understanding your request. Please try again or use /help for examples.'
                );
            }
        }
    }

    requiresAuth(functionName) {
        const authRequiredFunctions = [
            'create_calendar_event',
            'get_calendar_events', 
            'update_calendar_event',
            'delete_calendar_event',
            'search_calendar_events',
            'get_time_suggestions'
        ];
        return authRequiredFunctions.includes(functionName);
    }

    isAuthKeyword(messageText) {
        const authKeywords = [
            'connect google',
            'connect calendar', 
            'link google',
            'link calendar',
            'authenticate',
            'authorize',
            'login google',
            'sign in google',
            'google auth',
            'calendar auth',
            'connect my calendar',
            'link my calendar'
        ];
        
        const lowerText = messageText.toLowerCase();
        return authKeywords.some(keyword => lowerText.includes(keyword));
    }

    async sendWelcomeMessage(phoneNumber) {
        const welcomeMessage = `
🤖 **Welcome to your Productivity Assistant!**

Hi there! I'm here to help you with:

📅 **Calendar Management**
• Schedule events: "Schedule meeting tomorrow 2pm"
• View calendar: "What's on my calendar today?"
• Manage events: "Cancel my 3pm appointment"

⏰ **Productivity Tips**
• Time management strategies
• Daily planning advice
• Scheduling best practices

🔗 **Get Started:**
• For basic productivity help, just ask me anything!
• To connect your Google Calendar, say **"connect google"**
• Type **/help** for more commands

Try asking: "How can I be more productive?" or "Schedule lunch tomorrow at 1pm"

What would you like help with? 😊
        `.trim();
        
        await this.sendMessage(phoneNumber, welcomeMessage);
    }

    async buildUserContext(user) {
        try {
            // Get recent events for context
            const recentEvents = await this.calendarService.getUpcomingEvents(user, 48); // Next 48 hours
            
            // Get user preferences if available
            let userPreferences = {};
            if (user.preferences) {
                try {
                    userPreferences = JSON.parse(user.preferences);
                } catch (e) {
                    logger.warn('Failed to parse user preferences:', e);
                }
            }
            
            return {
                recentEvents: recentEvents.slice(0, 10), // Limit to 10 events for context
                userPreferences,
                authStatus: user.auth_status,
                timeZone: userPreferences.timeZone || 'UTC'
            };
            
        } catch (error) {
            logger.error('Error building user context:', error);
            return {
                recentEvents: [],
                userPreferences: {},
                authStatus: user.auth_status
            };
        }
    }

    async handleFallbackNLP(messageText, phoneNumber, user) {
        const nlpResult = this.nlp.processMessage(messageText);
        
        if (!nlpResult.isValid || nlpResult.confidence < 0.3) {
            await this.sendMessage(phoneNumber, 
                "🤔 I didn't quite understand that. Try commands like:\n" +
                "• 'Schedule meeting tomorrow 2pm'\n" +
                "• 'What's on my calendar today?'\n" +
                "• 'Cancel my 3pm appointment'\n\n" +
                "Type /help for more examples."
            );
            return;
        }

        // Route to appropriate handler based on action
        switch (nlpResult.action) {
            case 'create':
                await this.handleCreateEvent(phoneNumber, nlpResult, user);
                break;
            case 'view':
                await this.handleViewEvents(phoneNumber, nlpResult, user);
                break;
            case 'edit':
                await this.handleEditEvent(phoneNumber, nlpResult, user);
                break;
            case 'delete':
                await this.handleDeleteEvent(phoneNumber, nlpResult, user);
                break;
            default:
                await this.sendMessage(phoneNumber, 
                    "🤖 I understand you want to do something with your calendar, but I'm not sure what. Can you be more specific?"
                );
        }
    }

    async handleCreateEvent(phoneNumber, nlpResult, user) {
        try {
            // Confirm event details before creating
            const confirmMessage = this.formatEventConfirmation(nlpResult);
            await this.sendMessage(phoneNumber, confirmMessage + "\n\nReply 'yes' to confirm or 'no' to cancel.");
            
            // Store pending event for confirmation
            // This would need additional session state management
            
        } catch (error) {
            logger.error('Create event error:', error);
            await this.sendMessage(phoneNumber, 'Error creating event. Please try again.');
        }
    }

    async handleViewEvents(phoneNumber, nlpResult, user) {
        try {
            const timeRange = this.nlp.parseTimeQuery(nlpResult.originalText || 'today');
            const events = await this.calendarService.getEvents(user, timeRange);
            
            if (events.length === 0) {
                await this.sendMessage(phoneNumber, 'No events found for the specified time period.');
                return;
            }

            const eventsMessage = this.formatEventsDisplay(events);
            await this.sendMessage(phoneNumber, eventsMessage);
            
        } catch (error) {
            logger.error('View events error:', error);
            await this.sendMessage(phoneNumber, 'Error retrieving events. Please try again.');
        }
    }

    async handleEditEvent(phoneNumber, nlpResult, user) {
        await this.sendMessage(phoneNumber, 'Event editing is coming soon! For now, you can cancel and recreate events.');
    }

    async handleDeleteEvent(phoneNumber, nlpResult, user) {
        await this.sendMessage(phoneNumber, 'Event deletion is coming soon! Please use your calendar app to delete events for now.');
    }

    formatEventConfirmation(nlpResult) {
        let message = "📅 **Confirm Event Creation**\n\n";
        message += `**Title:** ${nlpResult.title}\n`;
        
        if (nlpResult.dateTime) {
            message += `**Date:** ${nlpResult.dateTime.start.toLocaleDateString()}\n`;
            message += `**Time:** ${nlpResult.dateTime.start.toLocaleTimeString()} - ${nlpResult.dateTime.end.toLocaleTimeString()}\n`;
        }
        
        if (nlpResult.location) {
            message += `**Location:** ${nlpResult.location}\n`;
        }
        
        if (nlpResult.attendees.length > 0) {
            message += `**Attendees:** ${nlpResult.attendees.join(', ')}\n`;
        }
        
        return message;
    }

    formatEventsDisplay(events) {
        let message = "📅 **Your Calendar**\n\n";
        
        events.forEach((event, index) => {
            message += `${index + 1}. **${event.title}**\n`;
            message += `   🕐 ${new Date(event.start_time).toLocaleString()}\n`;
            
            if (event.location) {
                message += `   📍 ${event.location}\n`;
            }
            
            message += "\n";
        });
        
        return message;
    }

    async sendMessage(phoneNumber, text) {
        try {
            await this.client.sendMessage(phoneNumber, text);
            logger.info(`Sent message to ${phoneNumber}: ${text.substring(0, 50)}...`);
        } catch (error) {
            logger.error('Error sending message:', error);
        }
    }
}

module.exports = MessageHandler;
