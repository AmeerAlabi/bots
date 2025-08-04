# WhatsApp Productivity Calendar Chatbot

A WhatsApp chatbot that helps you manage your Google Calendar through natural language conversations.

## Features

- 🧠 **Gemini AI Integration**: Advanced natural language understanding with function calling
- 🤖 **Smart Calendar Assistant**: Intelligent conversation flow with context awareness  
- 📅 **Google Calendar Integration**: Full sync with your Google Calendar
- 🔐 **Secure Authentication**: OAuth2 flow for Google Calendar access
- 💬 **WhatsApp Integration**: Chat-based interface using WhatsApp Web
- 📊 **Session Management**: Secure user sessions with automatic cleanup
- 🗄️ **SQLite Database**: Local storage for user data and session management
- 📝 **Comprehensive Logging**: Full audit trail and error tracking
- 🛠️ **Function Calling**: AI can directly execute calendar operations
- 🔄 **Fallback NLP**: Backup processing with chrono-node for reliability

## Quick Start

### Prerequisites

- Node.js 16 or higher
- Google Cloud Project with Calendar API enabled
- WhatsApp account for bot connection

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd whatsapp-productivity-bot
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Configure Google Calendar API:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google Calendar API
   - Create OAuth 2.0 credentials
   - Add your credentials to `.env`

4. **Start the bot:**
```bash
npm start
```

5. **Scan QR code with WhatsApp**

## Environment Configuration

Create a `.env` file with the following variables:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database
DB_PATH=./data/bot.db

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=24h

# Google Calendar API
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash

# Bot Configuration
BOT_NAME=ProductivityBot
SESSION_TIMEOUT=86400000
MAX_SESSIONS_PER_USER=3

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
```

## Usage Examples

### Getting Started
1. Send any message to the bot
2. Type `/start` for welcome message
3. Type `/auth` to authenticate with Google Calendar
4. Start managing your calendar!

### Creating Events
- "Schedule meeting tomorrow 2pm"
- "Book lunch with John Friday 1pm at Restaurant XYZ"
- "Add dentist appointment next Monday 10am for 1 hour"
- "Create team standup daily 9am"

### Viewing Calendar
- "What's on my calendar today?"
- "Show me tomorrow's schedule"
- "What's happening this week?"
- "Do I have any meetings this afternoon?"

### Managing Events
- "Move my 3pm meeting to 4pm"
- "Cancel my dentist appointment"
- "Reschedule lunch to next week"
- "Change my appointment to 2pm"

### Available Commands
- `/start` - Welcome message and setup
- `/auth` - Authenticate with Google Calendar
- `/status` - Check authentication status
- `/logout` - Sign out and clear data
- `/help` - Show available commands

## Architecture

### Project Structure
```
src/
├── modules/
│   └── messageHandler.js    # WhatsApp message processing
├── services/
│   ├── authService.js       # Google OAuth authentication
│   └── calendarService.js   # Google Calendar operations
├── models/
│   └── database.js          # SQLite database operations
└── utils/
    ├── logger.js            # Winston logging configuration
    └── nlpProcessor.js      # Natural language processing
```

### Key Components

- **MessageHandler**: Processes incoming WhatsApp messages and routes them appropriately
- **AuthService**: Manages Google OAuth2 authentication flow
- **CalendarService**: Handles all Google Calendar API operations
- **NLPProcessor**: Extracts intent and entities from natural language input
- **Database**: SQLite database with user, session, and event management

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /auth/google/callback` - Google OAuth callback

## Database Schema

### Users Table
- `id` - Primary key
- `phone_number` - WhatsApp phone number (unique)
- `name` - User's display name
- `auth_status` - Authentication status
- `google_tokens` - Encrypted OAuth tokens
- `preferences` - User preferences JSON
- `created_at` / `updated_at` - Timestamps

### Sessions Table
- `id` - Session UUID
- `user_id` - Foreign key to users
- `phone_number` - WhatsApp number
- `status` - Session status
- `created_at` / `expires_at` - Session lifecycle
- `last_activity` - Last interaction timestamp

### Message Logs Table
- Complete audit trail of all messages
- Performance metrics and error tracking
- User interaction analytics

## Security Features

- 🔐 **OAuth2 Authentication**: Secure Google account integration
- 🛡️ **JWT Tokens**: Secure session management
- 🚫 **Session Expiry**: Automatic cleanup of expired sessions
- 📝 **Audit Logging**: Complete message and action logging
- 🔒 **Token Encryption**: Secure storage of OAuth tokens
- ⚡ **Rate Limiting**: Protection against spam and abuse

## Development

### Running in Development Mode
```bash
npm run dev
```

### Testing
```bash
npm test
```

### Building for Production
```bash
npm run build
```

## Deployment

### Docker Deployment
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Environment Setup for Production
- Set `NODE_ENV=production`
- Use secure JWT secrets
- Configure proper HTTPS endpoints
- Set up log rotation
- Configure database backups

## Troubleshooting

### Common Issues

1. **QR Code Not Appearing**
   - Check console output for QR code
   - Ensure WhatsApp Web is not already connected elsewhere

2. **Authentication Fails**
   - Verify Google OAuth credentials
   - Check redirect URI configuration
   - Ensure Calendar API is enabled

3. **Events Not Creating**
   - Check Google Calendar API permissions
   - Verify token refresh is working
   - Check logs for API errors

### Logs Location
- Error logs: `./logs/error.log`
- Combined logs: `./logs/combined.log`
- Console output in development mode

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs for error details
3. Open an issue on GitHub with:
   - Error logs
   - Steps to reproduce
   - Environment details

---

**⚠️ Important Security Notes:**
- Never commit `.env` files or credentials
- Use strong JWT secrets in production
- Regularly rotate OAuth credentials
- Monitor logs for suspicious activity
