const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');
const logger = require('../utils/logger');

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ 
            model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
        });
        
        this.initializeToolDefinitions();
    }

    initializeToolDefinitions() {
        this.tools = [
            {
                functionDeclarations: [
                    {
                        name: "create_calendar_event",
                        description: "Create a new calendar event",
                        parameters: {
                            type: "object",
                            properties: {
                                title: {
                                    type: "string",
                                    description: "The title/summary of the event"
                                },
                                description: {
                                    type: "string",
                                    description: "Optional description of the event"
                                },
                                startDateTime: {
                                    type: "string",
                                    description: "Start date and time in ISO format (e.g., 2024-01-15T14:00:00Z)"
                                },
                                endDateTime: {
                                    type: "string",
                                    description: "End date and time in ISO format (e.g., 2024-01-15T15:00:00Z)"
                                },
                                location: {
                                    type: "string",
                                    description: "Optional location of the event"
                                },
                                attendees: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Optional list of attendee email addresses"
                                },
                                reminderMinutes: {
                                    type: "number",
                                    description: "Minutes before event to send reminder (default: 15)"
                                }
                            },
                            required: ["title", "startDateTime", "endDateTime"]
                        }
                    },
                    {
                        name: "get_calendar_events",
                        description: "Get calendar events for a specific time period",
                        parameters: {
                            type: "object",
                            properties: {
                                startDate: {
                                    type: "string",
                                    description: "Start date in ISO format (e.g., 2024-01-15T00:00:00Z)"
                                },
                                endDate: {
                                    type: "string",
                                    description: "End date in ISO format (e.g., 2024-01-15T23:59:59Z)"
                                },
                                query: {
                                    type: "string",
                                    description: "Optional search query to filter events"
                                }
                            },
                            required: ["startDate", "endDate"]
                        }
                    },
                    {
                        name: "update_calendar_event",
                        description: "Update an existing calendar event",
                        parameters: {
                            type: "object",
                            properties: {
                                eventId: {
                                    type: "string",
                                    description: "The ID of the event to update"
                                },
                                title: {
                                    type: "string",
                                    description: "New title for the event"
                                },
                                startDateTime: {
                                    type: "string",
                                    description: "New start date and time in ISO format"
                                },
                                endDateTime: {
                                    type: "string",
                                    description: "New end date and time in ISO format"
                                },
                                location: {
                                    type: "string",
                                    description: "New location for the event"
                                }
                            },
                            required: ["eventId"]
                        }
                    },
                    {
                        name: "delete_calendar_event",
                        description: "Delete a calendar event",
                        parameters: {
                            type: "object",
                            properties: {
                                eventId: {
                                    type: "string",
                                    description: "The ID of the event to delete"
                                },
                                searchTitle: {
                                    type: "string",
                                    description: "Alternative: search for event by title if eventId not available"
                                }
                            }
                        }
                    },
                    {
                        name: "search_calendar_events",
                        description: "Search for calendar events by title or description",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "Search query to find events"
                                },
                                timeRange: {
                                    type: "string",
                                    enum: ["today", "tomorrow", "this_week", "this_month", "all"],
                                    description: "Time range to search within"
                                }
                            },
                            required: ["query"]
                        }
                    },
                    {
                        name: "get_time_suggestions",
                        description: "Find available time slots for scheduling",
                        parameters: {
                            type: "object",
                            properties: {
                                date: {
                                    type: "string",
                                    description: "Date to check availability (YYYY-MM-DD)"
                                },
                                duration: {
                                    type: "number",
                                    description: "Duration in minutes for the event"
                                },
                                preferredTimes: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Preferred time slots (e.g., ['09:00', '14:00'])"
                                }
                            },
                            required: ["date", "duration"]
                        }
                    }
                ]
            }
        ];

        this.systemPrompt = `You are a helpful productivity assistant that can help with scheduling, time management, and calendar planning through WhatsApp messages.

Key capabilities:
- Answer productivity and time management questions
- Give scheduling advice and tips
- Help plan daily/weekly routines
- Provide time blocking strategies
- Create calendar events from natural language (if user is authenticated)
- View and search calendar events (if user is authenticated)
- Update or reschedule existing events (if user is authenticated)
- Delete events (if user is authenticated)
- Find available time slots (if user is authenticated)

Guidelines:
- Always be helpful and conversational
- For basic productivity questions, provide helpful advice without requiring authentication
- For actual calendar operations (create/view/edit events), check if user is authenticated first
- If user wants calendar features but isn't authenticated, guide them to use /auth
- Parse dates and times intelligently (today, tomorrow, next Monday, 2pm, etc.)
- Default event duration is 1 hour if not specified
- Ask for clarification if the request is ambiguous
- Use appropriate emojis to make responses friendly
- Provide productivity tips, time management strategies, and scheduling best practices

Current date and time: ${new Date().toISOString()}

When a user asks about productivity or general scheduling advice, respond directly.
When a user wants to interact with their actual calendar, use the appropriate function calls if they're authenticated.`;
    }

    async processMessage(message, userContext = {}) {
        try {
            const prompt = this.buildPrompt(message, userContext);
            
            const chat = this.model.startChat({
                tools: this.tools,
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 1024,
                }
            });

            const result = await chat.sendMessage(prompt);
            const response = result.response;

            // Check if the model wants to call functions
            const functionCalls = response.functionCalls();
            
            if (functionCalls && functionCalls.length > 0) {
                return {
                    type: 'function_calls',
                    functionCalls: functionCalls,
                    text: response.text() || ''
                };
            } else {
                return {
                    type: 'text',
                    text: response.text(),
                    functionCalls: []
                };
            }

        } catch (error) {
            logger.error('Gemini processing error:', error);
            throw new Error(`AI processing failed: ${error.message}`);
        }
    }

    buildPrompt(message, userContext) {
        let prompt = this.systemPrompt + '\n\n';
        
        if (userContext.recentEvents) {
            prompt += `Recent calendar events:\n${JSON.stringify(userContext.recentEvents, null, 2)}\n\n`;
        }
        
        if (userContext.userPreferences) {
            prompt += `User preferences: ${JSON.stringify(userContext.userPreferences)}\n\n`;
        }
        
        prompt += `User message: "${message}"\n\n`;
        prompt += `Please help the user with their calendar request. Use function calls when appropriate.`;
        
        return prompt;
    }

    async processWithFunctionResults(message, functionResults, userContext = {}) {
        try {
            const prompt = this.buildPromptWithResults(message, functionResults, userContext);
            
            const chat = this.model.startChat({
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 512,
                }
            });

            const result = await chat.sendMessage(prompt);
            return {
                type: 'text',
                text: result.response.text(),
                functionCalls: []
            };

        } catch (error) {
            logger.error('Gemini function result processing error:', error);
            throw new Error(`AI result processing failed: ${error.message}`);
        }
    }

    buildPromptWithResults(message, functionResults, userContext) {
        let prompt = `User asked: "${message}"\n\n`;
        prompt += `Function results:\n${JSON.stringify(functionResults, null, 2)}\n\n`;
        prompt += `Please provide a natural, helpful response to the user based on these results. `;
        prompt += `Be conversational and use appropriate emojis. If there were any issues, explain them clearly.`;
        
        return prompt;
    }

    // Helper method to validate function call parameters
    validateFunctionCall(functionCall) {
        const schemas = {
            create_calendar_event: z.object({
                title: z.string().min(1),
                description: z.string().optional(),
                startDateTime: z.string().datetime(),
                endDateTime: z.string().datetime(),
                location: z.string().optional(),
                attendees: z.array(z.string().email()).optional(),
                reminderMinutes: z.number().positive().optional()
            }),
            get_calendar_events: z.object({
                startDate: z.string().datetime(),
                endDate: z.string().datetime(),
                query: z.string().optional()
            }),
            update_calendar_event: z.object({
                eventId: z.string().min(1),
                title: z.string().optional(),
                startDateTime: z.string().datetime().optional(),
                endDateTime: z.string().datetime().optional(),
                location: z.string().optional()
            }),
            delete_calendar_event: z.object({
                eventId: z.string().optional(),
                searchTitle: z.string().optional()
            }).refine(data => data.eventId || data.searchTitle, {
                message: "Either eventId or searchTitle must be provided"
            }),
            search_calendar_events: z.object({
                query: z.string().min(1),
                timeRange: z.enum(["today", "tomorrow", "this_week", "this_month", "all"]).optional()
            })
        };

        const schema = schemas[functionCall.name];
        if (!schema) {
            throw new Error(`Unknown function: ${functionCall.name}`);
        }

        try {
            return schema.parse(functionCall.args);
        } catch (error) {
            logger.error(`Function call validation failed for ${functionCall.name}:`, error);
            throw new Error(`Invalid parameters for ${functionCall.name}: ${error.message}`);
        }
    }

    // Helper method to convert natural language time references to ISO dates
    parseTimeReference(timeRef) {
        const now = new Date();
        
        switch (timeRef) {
            case 'today':
                return {
                    start: new Date(now.setHours(0, 0, 0, 0)).toISOString(),
                    end: new Date(now.setHours(23, 59, 59, 999)).toISOString()
                };
            case 'tomorrow':
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                return {
                    start: new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString(),
                    end: new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString()
                };
            case 'this_week':
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6));
                return {
                    start: new Date(startOfWeek.setHours(0, 0, 0, 0)).toISOString(),
                    end: new Date(endOfWeek.setHours(23, 59, 59, 999)).toISOString()
                };
            default:
                return {
                    start: new Date(now.setHours(0, 0, 0, 0)).toISOString(),
                    end: new Date(now.setHours(23, 59, 59, 999)).toISOString()
                };
        }
    }
}

module.exports = GeminiService;
