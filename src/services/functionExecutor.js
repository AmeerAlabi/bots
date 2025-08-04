const logger = require('../utils/logger');
const CalendarService = require('./calendarService');

class FunctionExecutor {
    constructor(database) {
        this.database = database;
        this.calendarService = new CalendarService(database);
    }

    async executeFunctionCall(functionCall, user) {
        try {
            logger.info(`Executing function: ${functionCall.name}`, { 
                args: functionCall.args, 
                user: user.phone_number 
            });

            switch (functionCall.name) {
                case 'create_calendar_event':
                    return await this.createCalendarEvent(functionCall.args, user);
                
                case 'get_calendar_events':
                    return await this.getCalendarEvents(functionCall.args, user);
                
                case 'update_calendar_event':
                    return await this.updateCalendarEvent(functionCall.args, user);
                
                case 'delete_calendar_event':
                    return await this.deleteCalendarEvent(functionCall.args, user);
                
                case 'search_calendar_events':
                    return await this.searchCalendarEvents(functionCall.args, user);
                
                case 'get_time_suggestions':
                    return await this.getTimeSuggestions(functionCall.args, user);
                
                default:
                    throw new Error(`Unknown function: ${functionCall.name}`);
            }

        } catch (error) {
            logger.error(`Function execution error for ${functionCall.name}:`, error);
            return {
                success: false,
                error: error.message,
                function: functionCall.name
            };
        }
    }

    async createCalendarEvent(args, user) {
        try {
            const eventData = {
                title: args.title,
                description: args.description || '',
                startTime: new Date(args.startDateTime),
                endTime: new Date(args.endDateTime),
                location: args.location || null,
                attendees: args.attendees || [],
                reminderMinutes: args.reminderMinutes || 15
            };

            // Validate dates
            if (eventData.startTime >= eventData.endTime) {
                throw new Error('Start time must be before end time');
            }

            if (eventData.startTime < new Date()) {
                throw new Error('Cannot create events in the past');
            }

            const createdEvent = await this.calendarService.createEvent(user, eventData);

            return {
                success: true,
                event: {
                    id: createdEvent.id,
                    title: eventData.title,
                    start: eventData.startTime.toISOString(),
                    end: eventData.endTime.toISOString(),
                    location: eventData.location,
                    attendees: eventData.attendees
                },
                message: `Event "${eventData.title}" created successfully`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'create_calendar_event'
            };
        }
    }

    async getCalendarEvents(args, user) {
        try {
            const timeRange = {
                start: new Date(args.startDate),
                end: new Date(args.endDate)
            };

            let events = await this.calendarService.getEvents(user, timeRange);

            // Filter by query if provided
            if (args.query) {
                const query = args.query.toLowerCase();
                events = events.filter(event => 
                    event.title.toLowerCase().includes(query) ||
                    (event.description && event.description.toLowerCase().includes(query)) ||
                    (event.location && event.location.toLowerCase().includes(query))
                );
            }

            return {
                success: true,
                events: events.map(event => ({
                    id: event.id,
                    title: event.title,
                    start: event.start_time,
                    end: event.end_time,
                    location: event.location,
                    status: event.status,
                    attendees: event.attendees
                })),
                count: events.length,
                timeRange: {
                    start: args.startDate,
                    end: args.endDate
                }
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'get_calendar_events'
            };
        }
    }

    async updateCalendarEvent(args, user) {
        try {
            const updates = {};
            
            if (args.title) updates.title = args.title;
            if (args.startDateTime) updates.startTime = new Date(args.startDateTime);
            if (args.endDateTime) updates.endTime = new Date(args.endDateTime);
            if (args.location !== undefined) updates.location = args.location;

            // Validate dates if provided
            if (updates.startTime && updates.endTime && updates.startTime >= updates.endTime) {
                throw new Error('Start time must be before end time');
            }

            const updatedEvent = await this.calendarService.updateEvent(user, args.eventId, updates);

            return {
                success: true,
                event: {
                    id: updatedEvent.id,
                    title: updatedEvent.summary,
                    start: updatedEvent.start.dateTime,
                    end: updatedEvent.end.dateTime,
                    location: updatedEvent.location
                },
                message: `Event updated successfully`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'update_calendar_event'
            };
        }
    }

    async deleteCalendarEvent(args, user) {
        try {
            let eventId = args.eventId;

            // If no eventId provided, search by title
            if (!eventId && args.searchTitle) {
                const events = await this.calendarService.findEventsByTitle(user, args.searchTitle);
                
                if (events.length === 0) {
                    throw new Error(`No events found with title containing "${args.searchTitle}"`);
                }
                
                if (events.length > 1) {
                    return {
                        success: false,
                        error: `Multiple events found with "${args.searchTitle}". Please be more specific.`,
                        events: events.map(e => ({ id: e.id, title: e.title, start: e.start_time })),
                        function: 'delete_calendar_event'
                    };
                }
                
                eventId = events[0].id;
            }

            if (!eventId) {
                throw new Error('Event ID or search title is required');
            }

            await this.calendarService.deleteEvent(user, eventId);

            return {
                success: true,
                eventId: eventId,
                message: `Event deleted successfully`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'delete_calendar_event'
            };
        }
    }

    async searchCalendarEvents(args, user) {
        try {
            let timeRange = null;

            // Convert time range to dates
            if (args.timeRange) {
                timeRange = this.parseTimeRange(args.timeRange);
            }

            const events = await this.calendarService.findEventsByTitle(user, args.query, timeRange);

            return {
                success: true,
                events: events.map(event => ({
                    id: event.id,
                    title: event.title,
                    start: event.start_time,
                    end: event.end_time,
                    location: event.location,
                    status: event.status
                })),
                query: args.query,
                timeRange: args.timeRange,
                count: events.length
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'search_calendar_events'
            };
        }
    }

    async getTimeSuggestions(args, user) {
        try {
            const date = new Date(args.date);
            const startOfDay = new Date(date.setHours(9, 0, 0, 0)); // 9 AM
            const endOfDay = new Date(date.setHours(17, 0, 0, 0)); // 5 PM

            // Get existing events for the day
            const events = await this.calendarService.getEvents(user, {
                start: new Date(date.setHours(0, 0, 0, 0)),
                end: new Date(date.setHours(23, 59, 59, 999))
            });

            // Find available slots
            const suggestions = this.findAvailableSlots(
                startOfDay,
                endOfDay,
                events,
                args.duration,
                args.preferredTimes
            );

            return {
                success: true,
                date: args.date,
                duration: args.duration,
                suggestions: suggestions,
                existingEvents: events.length
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                function: 'get_time_suggestions'
            };
        }
    }

    parseTimeRange(timeRange) {
        const now = new Date();
        
        switch (timeRange) {
            case 'today':
                return {
                    start: new Date(now.setHours(0, 0, 0, 0)),
                    end: new Date(now.setHours(23, 59, 59, 999))
                };
            case 'tomorrow':
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                return {
                    start: new Date(tomorrow.setHours(0, 0, 0, 0)),
                    end: new Date(tomorrow.setHours(23, 59, 59, 999))
                };
            case 'this_week':
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6));
                return {
                    start: new Date(startOfWeek.setHours(0, 0, 0, 0)),
                    end: new Date(endOfWeek.setHours(23, 59, 59, 999))
                };
            case 'this_month':
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                return { start: startOfMonth, end: endOfMonth };
            default:
                return null;
        }
    }

    findAvailableSlots(startTime, endTime, existingEvents, durationMinutes, preferredTimes = []) {
        const slots = [];
        const duration = durationMinutes * 60 * 1000; // Convert to milliseconds
        
        // Sort existing events by start time
        const sortedEvents = existingEvents
            .filter(event => event.start_time && event.end_time)
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

        let currentTime = new Date(startTime);
        
        for (const event of sortedEvents) {
            const eventStart = new Date(event.start_time);
            const eventEnd = new Date(event.end_time);
            
            // Check if there's space before this event
            if (currentTime < eventStart && (eventStart - currentTime) >= duration) {
                const slotEnd = new Date(Math.min(eventStart, currentTime.getTime() + duration));
                slots.push({
                    start: currentTime.toISOString(),
                    end: slotEnd.toISOString(),
                    duration: Math.floor((slotEnd - currentTime) / (60 * 1000))
                });
            }
            
            // Move past this event
            currentTime = new Date(Math.max(currentTime, eventEnd));
        }
        
        // Check for time after the last event
        if (currentTime < endTime && (endTime - currentTime) >= duration) {
            const slotEnd = new Date(Math.min(endTime, currentTime.getTime() + duration));
            slots.push({
                start: currentTime.toISOString(),
                end: slotEnd.toISOString(),
                duration: Math.floor((slotEnd - currentTime) / (60 * 1000))
            });
        }
        
        // Prioritize preferred times if provided
        if (preferredTimes.length > 0) {
            return slots.sort((a, b) => {
                const aTime = new Date(a.start).toTimeString().slice(0, 5);
                const bTime = new Date(b.start).toTimeString().slice(0, 5);
                
                const aPreferred = preferredTimes.includes(aTime);
                const bPreferred = preferredTimes.includes(bTime);
                
                if (aPreferred && !bPreferred) return -1;
                if (!aPreferred && bPreferred) return 1;
                return 0;
            });
        }
        
        return slots;
    }
}

module.exports = FunctionExecutor;
