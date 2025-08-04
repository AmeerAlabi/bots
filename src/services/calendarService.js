const { google } = require('googleapis');
const logger = require('../utils/logger');
const AuthService = require('./authService');

class CalendarService {
    constructor(database) {
        this.database = database;
        this.authService = new AuthService(database);
    }

    async createEvent(user, eventData) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });

            const event = {
                summary: eventData.title,
                description: eventData.description || '',
                start: {
                    dateTime: eventData.startTime.toISOString(),
                    timeZone: 'UTC'
                },
                end: {
                    dateTime: eventData.endTime.toISOString(),
                    timeZone: 'UTC'
                }
            };

            if (eventData.location) {
                event.location = eventData.location;
            }

            if (eventData.attendees && eventData.attendees.length > 0) {
                event.attendees = eventData.attendees.map(email => ({ email }));
            }

            if (eventData.reminderMinutes) {
                event.reminders = {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: eventData.reminderMinutes }
                    ]
                };
            }

            const response = await calendar.events.insert({
                calendarId: 'primary',
                resource: event
            });

            // Store event in local database
            await this.database.run(
                `INSERT INTO calendar_events 
                 (user_id, google_event_id, title, description, start_time, end_time, location, attendees, reminder_minutes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user.id,
                    response.data.id,
                    eventData.title,
                    eventData.description || null,
                    eventData.startTime.toISOString(),
                    eventData.endTime.toISOString(),
                    eventData.location || null,
                    eventData.attendees ? JSON.stringify(eventData.attendees) : null,
                    eventData.reminderMinutes || 15
                ]
            );

            logger.info(`Event created successfully for user ${user.phone_number}: ${eventData.title}`);
            return response.data;

        } catch (error) {
            logger.error('Error creating calendar event:', error);
            throw error;
        }
    }

    async getEvents(user, timeRange = null) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });

            const params = {
                calendarId: 'primary',
                orderBy: 'startTime',
                singleEvents: true,
                maxResults: 50
            };

            if (timeRange) {
                params.timeMin = timeRange.start.toISOString();
                params.timeMax = timeRange.end.toISOString();
            } else {
                // Default to today
                const today = new Date();
                const startOfDay = new Date(today.setHours(0, 0, 0, 0));
                const endOfDay = new Date(today.setHours(23, 59, 59, 999));
                
                params.timeMin = startOfDay.toISOString();
                params.timeMax = endOfDay.toISOString();
            }

            const response = await calendar.events.list(params);
            const events = response.data.items || [];

            logger.info(`Retrieved ${events.length} events for user ${user.phone_number}`);
            return events.map(event => ({
                id: event.id,
                title: event.summary || 'Untitled Event',
                description: event.description || '',
                start_time: event.start.dateTime || event.start.date,
                end_time: event.end.dateTime || event.end.date,
                location: event.location || null,
                attendees: event.attendees ? event.attendees.map(a => a.email) : [],
                status: event.status
            }));

        } catch (error) {
            logger.error('Error retrieving calendar events:', error);
            throw error;
        }
    }

    async updateEvent(user, eventId, updates) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });

            // Get existing event
            const existingEvent = await calendar.events.get({
                calendarId: 'primary',
                eventId: eventId
            });

            const updatedEvent = { ...existingEvent.data };

            // Apply updates
            if (updates.title !== undefined) updatedEvent.summary = updates.title;
            if (updates.description !== undefined) updatedEvent.description = updates.description;
            if (updates.location !== undefined) updatedEvent.location = updates.location;
            
            if (updates.startTime) {
                updatedEvent.start = {
                    dateTime: updates.startTime.toISOString(),
                    timeZone: 'UTC'
                };
            }
            
            if (updates.endTime) {
                updatedEvent.end = {
                    dateTime: updates.endTime.toISOString(),
                    timeZone: 'UTC'
                };
            }

            const response = await calendar.events.update({
                calendarId: 'primary',
                eventId: eventId,
                resource: updatedEvent
            });

            // Update local database
            const updateFields = [];
            const updateValues = [];
            
            if (updates.title !== undefined) {
                updateFields.push('title = ?');
                updateValues.push(updates.title);
            }
            
            if (updates.startTime) {
                updateFields.push('start_time = ?');
                updateValues.push(updates.startTime.toISOString());
            }
            
            if (updates.endTime) {
                updateFields.push('end_time = ?');
                updateValues.push(updates.endTime.toISOString());
            }
            
            if (updateFields.length > 0) {
                updateFields.push('updated_at = CURRENT_TIMESTAMP');
                updateValues.push(user.id, eventId);
                
                await this.database.run(
                    `UPDATE calendar_events SET ${updateFields.join(', ')} 
                     WHERE user_id = ? AND google_event_id = ?`,
                    updateValues
                );
            }

            logger.info(`Event updated successfully for user ${user.phone_number}: ${eventId}`);
            return response.data;

        } catch (error) {
            logger.error('Error updating calendar event:', error);
            throw error;
        }
    }

    async deleteEvent(user, eventId) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });

            await calendar.events.delete({
                calendarId: 'primary',
                eventId: eventId
            });

            // Remove from local database
            await this.database.run(
                'DELETE FROM calendar_events WHERE user_id = ? AND google_event_id = ?',
                [user.id, eventId]
            );

            logger.info(`Event deleted successfully for user ${user.phone_number}: ${eventId}`);
            return true;

        } catch (error) {
            logger.error('Error deleting calendar event:', error);
            throw error;
        }
    }

    async findEventsByTitle(user, title, timeRange = null) {
        try {
            const events = await this.getEvents(user, timeRange);
            return events.filter(event => 
                event.title.toLowerCase().includes(title.toLowerCase())
            );
        } catch (error) {
            logger.error('Error finding events by title:', error);
            throw error;
        }
    }

    async getUpcomingEvents(user, hours = 24) {
        try {
            const now = new Date();
            const future = new Date(now.getTime() + (hours * 60 * 60 * 1000));
            
            return await this.getEvents(user, {
                start: now,
                end: future
            });
        } catch (error) {
            logger.error('Error getting upcoming events:', error);
            throw error;
        }
    }

    async createQuickEvent(user, quickText) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });

            const response = await calendar.events.quickAdd({
                calendarId: 'primary',
                text: quickText
            });

            logger.info(`Quick event created for user ${user.phone_number}: ${quickText}`);
            return response.data;

        } catch (error) {
            logger.error('Error creating quick event:', error);
            throw error;
        }
    }

    // Helper method to check calendar access
    async testCalendarAccess(user) {
        try {
            const auth = await this.authService.getAuthenticatedClient(user);
            const calendar = google.calendar({ version: 'v3', auth });
            
            await calendar.calendarList.list();
            return true;
        } catch (error) {
            logger.error('Calendar access test failed:', error);
            return false;
        }
    }
}

module.exports = CalendarService;
