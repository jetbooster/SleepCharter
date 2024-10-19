"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const date_fns_1 = require("date-fns");
const date_fns_tz_1 = require("date-fns-tz");
require("dotenv/config");
const promises_1 = require("fs/promises");
const google_auth_library_1 = require("google-auth-library");
const googleapis_1 = require("googleapis");
const path_1 = require("path");
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
var EventType;
(function (EventType) {
    EventType["SLEEP"] = "SLEEP";
    EventType["WAKE"] = "WAKE";
})(EventType || (EventType = {}));
const SHEET_ID = process.env.SHEET_ID;
const login = async () => {
    const auth = new google_auth_library_1.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    });
    const service = googleapis_1.google.sheets({ version: 'v4', auth });
    return service;
};
const getSheetCache = async (id) => {
    const now = Number(new Date());
    try {
        const fyl = await (0, promises_1.readFile)((0, path_1.join)(__dirname, 'cache', 'cache.json'), 'utf-8');
        const file = JSON.parse(fyl);
        if (file.cacheExpiry < now || file.id !== id) {
            return undefined;
        }
        else {
            return file.data;
        }
    }
    catch (e) {
        console.error(e.message);
        return undefined;
    }
};
const updateCache = async (id, vals) => {
    const now = Number(new Date());
    const expiry = Number(new Date(now + 60 * 60 * 1000));
    const cache = {
        cacheExpiry: expiry,
        id,
        data: vals
    };
    await (0, promises_1.mkdir)((0, path_1.join)(__dirname, 'cache'), { recursive: true });
    return (0, promises_1.writeFile)((0, path_1.join)(__dirname, 'cache', 'cache.json'), JSON.stringify(cache));
};
const getSheetData = async (id) => {
    const cache = await getSheetCache(id);
    if (cache) {
        console.log('cache hit');
        return cache;
    }
    console.log('cache miss');
    const service = await login();
    console.log('logged in');
    const sheetMeta = await service.spreadsheets.get({ spreadsheetId: id });
    const props = sheetMeta.data.sheets?.[0].properties?.gridProperties;
    if (!props) {
        throw Error('what');
    }
    const sheetData = await service.spreadsheets.values.get({ spreadsheetId: id, range: "A1:Z20", majorDimension: 'COLUMNS' });
    if (!sheetData.data.values) {
        throw Error('Sheet contained no data');
    }
    await updateCache(id, sheetData.data.values);
    return sheetData.data.values;
};
const parseTime = (s, referenceDate) => {
    try {
        return (0, date_fns_tz_1.fromZonedTime)((0, date_fns_1.parse)(s, 'HH:mm', referenceDate), 'UTC').toISOString();
    }
    catch (e) {
        console.error(e.message);
        return (0, date_fns_tz_1.fromZonedTime)((0, date_fns_1.parse)(s, 'HH:mm:ss', referenceDate), 'UTC').toISOString();
    }
};
const parseCol = (values) => {
    const firstBlank = values.findIndex((val) => val === '');
    const now = (0, date_fns_tz_1.toZonedTime)(new Date(), tz);
    const date = (0, date_fns_tz_1.fromZonedTime)((0, date_fns_1.parse)(values[0], "dd/MM/yy", now), 'UTC');
    const vals = values.slice(1, firstBlank);
    let eventType = EventType.SLEEP;
    let lastTime = null;
    const events = [];
    for (const val of vals) {
        if (val == '00:00:00' || val == '00:00') {
            eventType = EventType.WAKE;
            continue;
        }
        if (val == '23:59:00' || val == '23:59') {
            continue;
        }
        if (val === lastTime) {
            continue;
        }
        lastTime = val;
        const thisEvent = {
            time: parseTime(val, date),
            eventType
        };
        events.push(thisEvent);
        if (eventType === EventType.SLEEP) {
            eventType = EventType.WAKE;
        }
        else {
            eventType = EventType.SLEEP;
        }
    }
    const day = {
        date: date.toISOString(),
        values: events
    };
    return day;
};
const hasData = (col) => !!col[0];
const parseCols = (grid) => grid.filter(hasData).map(parseCol);
const buildCsv = async (events) => {
    let sleepTime = null;
    let wakeTime = null;
    try {
        await (0, promises_1.mkdir)((0, path_1.join)(__dirname, 'out'), { recursive: true });
        const fyl = await (0, promises_1.open)((0, path_1.join)(__dirname, 'out', 'sleepData.csv'), "w");
        const stream = fyl.createWriteStream();
        stream.write('Sleep,Wake\n');
        if (events[0].eventType === EventType.WAKE) {
            sleepTime = (0, date_fns_tz_1.formatInTimeZone)((0, date_fns_1.startOfDay)(new Date(events[0].time)), tz, "dd/MM/yyyy HH:mm:ss");
        }
        ;
        for (const event of events) {
            switch (event.eventType) {
                case EventType.SLEEP: {
                    sleepTime = (0, date_fns_tz_1.formatInTimeZone)(new Date(event.time), "UTC", "dd/MM/yyyy HH:mm:ss");
                    break;
                }
                case EventType.WAKE: {
                    if (wakeTime) {
                        stream.write('\n');
                    }
                    wakeTime = (0, date_fns_tz_1.formatInTimeZone)(new Date(event.time), "UTC", "dd/MM/yyyy HH:mm:ss");
                    stream.write(`${sleepTime},${wakeTime}`);
                    break;
                }
            }
        }
    }
    catch (e) {
        console.error(e.message);
    }
};
/**
 * Convert the disgusting format of our existing spreadsheet to basic sleep/wake events
 */
const main = async () => {
    if (!SHEET_ID) {
        console.log('Please create a .env file with SHEET_ID=...');
    }
    const result = await getSheetData(SHEET_ID);
    const parsedCols = parseCols(result);
    const eventsOnly = parsedCols.flatMap((day) => day.values);
    buildCsv(eventsOnly);
};
main();
