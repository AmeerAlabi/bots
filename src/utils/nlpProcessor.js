const chrono = require('chrono-node');
const logger = require('./logger');

class NLPProcessor {
    constructor() {
        this.eventKeywords = {
            meeting: ['meeting', 'meet', 'conference', 'call', 'discussion'],
            appointment: ['appointment', 'appt', 'visit', 'checkup'],
            reminder: ['remind', 'reminder', 'alert', 'notify'],
            deadline: ['deadline', 'due', 'submit', 'finish'],
            personal: ['lunch', 'dinner', 'coffee', 'workout', 'gym']
        };

        this.actionKeywords = {
            create: ['schedule', 'book', 'create', 'add', 'set', 'plan'],
            view: ['show', 'list', 'view', 'what', 'when', 'check'],
            edit: ['change', 'move', 'reschedule', 'update', 'modify'],
            delete: ['cancel', 'remove', 'delete', 'clear']
        };

        this.timeKeywords = {
            morning: { start: 9, end: 12 },
            afternoon: { start: 13, end: 17 },
            evening: { start: 18, end: 21 },
            night: { start: 22, end: 23 }
        };
    }

    processMessage(message) {
        const text = message.toLowerCase().trim();
        
        const result = {
            action: this.detectAction(text),
            eventType: this.detectEventType(text),
            dateTime: this.extractDateTime(text),
            duration: this.extractDuration(text),
            title: this.extractTitle(text),
            location: this.extractLocation(text),
            attendees: this.extractAttendees(text),
            isValid: false,
            confidence: 0
        };

        result.isValid = this.validateExtraction(result);
        result.confidence = this.calculateConfidence(result, text);

        logger.info('NLP Processing result:', result);
        return result;
    }

    detectAction(text) {
        for (const [action, keywords] of Object.entries(this.actionKeywords)) {
            if (keywords.some(keyword => text.includes(keyword))) {
                return action;
            }
        }
        return 'unknown';
    }

    detectEventType(text) {
        for (const [type, keywords] of Object.entries(this.eventKeywords)) {
            if (keywords.some(keyword => text.includes(keyword))) {
                return type;
            }
        }
        return 'general';
    }

    extractDateTime(text) {
        try {
            const results = chrono.parse(text);
            
            if (results.length === 0) {
                return null;
            }

            const parsed = results[0];
            let startDate = parsed.start.date();
            
            // Handle relative time expressions
            if (text.includes('tomorrow')) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                startDate.setFullYear(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
            }

            // Handle time of day keywords
            for (const [timeWord, timeRange] of Object.entries(this.timeKeywords)) {
                if (text.includes(timeWord)) {
                    startDate.setHours(timeRange.start, 0, 0, 0);
                    break;
                }
            }

            return {
                start: startDate,
                end: parsed.end ? parsed.end.date() : new Date(startDate.getTime() + 60 * 60 * 1000), // +1 hour default
                allDay: !parsed.start.isCertain('hour')
            };
        } catch (error) {
            logger.error('DateTime extraction error:', error);
            return null;
        }
    }

    extractDuration(text) {
        const durationPatterns = [
            /(\d+)\s*hours?/i,
            /(\d+)\s*hrs?/i,
            /(\d+)\s*minutes?/i,
            /(\d+)\s*mins?/i,
            /(\d+)\s*h/i,
            /(\d+)\s*m/i
        ];

        for (const pattern of durationPatterns) {
            const match = text.match(pattern);
            if (match) {
                const value = parseInt(match[1]);
                if (pattern.source.includes('hour') || pattern.source.includes('hrs') || pattern.source.includes('h')) {
                    return value * 60; // Convert to minutes
                }
                return value; // Already in minutes
            }
        }

        // Default duration based on event type
        const defaultDurations = {
            meeting: 60,
            appointment: 30,
            call: 30,
            lunch: 60,
            dinner: 90
        };

        for (const [type, duration] of Object.entries(defaultDurations)) {
            if (text.includes(type)) {
                return duration;
            }
        }

        return 60; // Default 1 hour
    }

    extractTitle(text) {
        // Remove action words and common phrases
        let title = text;
        
        const removeWords = [
            'schedule', 'book', 'create', 'add', 'set', 'plan',
            'show', 'list', 'view', 'what', 'when', 'check',
            'change', 'move', 'reschedule', 'update', 'modify',
            'cancel', 'remove', 'delete', 'clear',
            'a', 'an', 'the', 'for', 'with', 'at', 'on', 'in'
        ];

        // Remove dates and times (rough approach)
        title = title.replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '');
        title = title.replace(/\b\d{1,2}:\d{2}\b/g, '');
        title = title.replace(/\b\d{1,2}(am|pm)\b/gi, '');
        title = title.replace(/\b(morning|afternoon|evening|night)\b/gi, '');

        // Remove common action words
        removeWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            title = title.replace(regex, '');
        });

        // Clean up and capitalize
        title = title.trim().replace(/\s+/g, ' ');
        if (title.length > 0) {
            title = title.charAt(0).toUpperCase() + title.slice(1);
        }

        return title || 'New Event';
    }

    extractLocation(text) {
        const locationPatterns = [
            /\bat\s+([^,\n]+)/i,
            /\bin\s+([^,\n]+)/i,
            /\@\s*([^,\n]+)/i
        ];

        for (const pattern of locationPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }

        return null;
    }

    extractAttendees(text) {
        const attendeePatterns = [
            /\bwith\s+([^,\n]+)/i,
            /\binvite\s+([^,\n]+)/i,
            /\binclude\s+([^,\n]+)/i
        ];

        for (const pattern of attendeePatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].split(/\s+and\s+|\s*,\s*/).map(name => name.trim());
            }
        }

        return [];
    }

    validateExtraction(result) {
        // Must have an action
        if (result.action === 'unknown') {
            return false;
        }

        // Create actions must have datetime
        if (result.action === 'create' && !result.dateTime) {
            return false;
        }

        // Must have some meaningful content
        if (result.action === 'create' && !result.title && !result.eventType) {
            return false;
        }

        return true;
    }

    calculateConfidence(result, originalText) {
        let confidence = 0;

        // Action detection confidence
        if (result.action !== 'unknown') confidence += 0.3;

        // DateTime confidence
        if (result.dateTime) confidence += 0.3;

        // Title/content confidence
        if (result.title && result.title !== 'New Event') confidence += 0.2;

        // Event type confidence
        if (result.eventType !== 'general') confidence += 0.1;

        // Additional details confidence
        if (result.location) confidence += 0.05;
        if (result.attendees.length > 0) confidence += 0.05;

        return Math.min(confidence, 1.0);
    }

    // Helper method for time queries
    parseTimeQuery(text) {
        const queries = {
            today: () => {
                const today = new Date();
                return {
                    start: new Date(today.setHours(0, 0, 0, 0)),
                    end: new Date(today.setHours(23, 59, 59, 999))
                };
            },
            tomorrow: () => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                return {
                    start: new Date(tomorrow.setHours(0, 0, 0, 0)),
                    end: new Date(tomorrow.setHours(23, 59, 59, 999))
                };
            },
            'this week': () => {
                const now = new Date();
                const start = new Date(now.setDate(now.getDate() - now.getDay()));
                const end = new Date(now.setDate(now.getDate() - now.getDay() + 6));
                return { start, end };
            }
        };

        for (const [query, fn] of Object.entries(queries)) {
            if (text.includes(query)) {
                return fn();
            }
        }

        return null;
    }
}

module.exports = NLPProcessor;
