# Agent Instructions for WhatsApp Productivity Bot

## Project Overview
This is a WhatsApp productivity chatbot that integrates with Google Calendar using Gemini AI for natural language processing and function calling.

## Key Commands

### Development
- `npm start` - Start the bot in production mode
- `npm run dev` - Start with nodemon for development
- `npm test` - Run tests
- `npm install` - Install dependencies
- `npm audit fix` - Fix security vulnerabilities

### Testing
- No specific test framework configured yet
- Manual testing via WhatsApp messages
- Check logs in `./logs/` directory

## Architecture

### Core Components
- **Main Entry**: `index.js` - WhatsApp client initialization
- **Message Handler**: `src/modules/messageHandler.js` - Routes and processes messages
- **Gemini Service**: `src/services/geminiService.js` - AI processing with function calling
- **Function Executor**: `src/services/functionExecutor.js` - Executes calendar operations
- **Calendar Service**: `src/services/calendarService.js` - Google Calendar API operations
- **Auth Service**: `src/services/authService.js` - OAuth2 authentication
- **Database**: `src/models/database.js` - SQLite operations

### Key Features
- **Gemini AI Integration**: Natural language understanding with tool calling
- **Function Calling**: AI can call specific functions for calendar operations
- **Google Calendar**: Full CRUD operations on calendar events
- **WhatsApp Integration**: Chat-based interface
- **OAuth2 Authentication**: Secure Google account integration
- **Session Management**: User sessions with expiration
- **Fallback NLP**: chrono-node for date/time parsing if Gemini fails

## Environment Setup

Required environment variables:
```env
GEMINI_API_KEY=your-gemini-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
JWT_SECRET=your-jwt-secret
```

## Function Calling System

The bot uses Gemini's function calling capabilities with these tools:
- `create_calendar_event` - Create new events
- `get_calendar_events` - Retrieve events for date ranges
- `update_calendar_event` - Modify existing events
- `delete_calendar_event` - Remove events
- `search_calendar_events` - Find events by query
- `get_time_suggestions` - Find available time slots

## Usage Examples

### Creating Events
- "Schedule meeting tomorrow 2pm"
- "Book lunch with John Friday 1pm at Restaurant XYZ"
- "Add dentist appointment next Monday 10am for 1 hour"

### Viewing Calendar
- "What's on my calendar today?"
- "Show me tomorrow's schedule" 
- "What's happening this week?"

### Managing Events
- "Move my 3pm meeting to 4pm"
- "Cancel my dentist appointment"
- "Reschedule lunch to next week"

## Code Style
- Use ES6+ features
- Async/await for promises
- Comprehensive error handling
- Winston for logging
- Zod for validation
- No comments unless complex logic

## Troubleshooting

### Common Issues
1. **QR Code not appearing**: Check console output
2. **Gemini not responding**: Verify GEMINI_API_KEY
3. **Calendar operations failing**: Check Google OAuth credentials
4. **Database errors**: Ensure data directory exists

### Logs
- Error logs: `./logs/error.log`
- Combined logs: `./logs/combined.log`
- Console output in development

## Security Notes
- Never commit `.env` files
- OAuth tokens are encrypted in database
- Session cleanup runs automatically
- Rate limiting implemented for API calls
