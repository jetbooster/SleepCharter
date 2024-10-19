import { parse, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import 'dotenv/config';
import { mkdir, open, readFile, writeFile } from 'fs/promises';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { join } from 'path';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

enum EventType {
  SLEEP = "SLEEP", WAKE = "WAKE"
}

interface TimeEvent {
  eventType: EventType
  time: string
}

interface Day {
  date: string,
  values: TimeEvent[]
}

interface Cache {
  cacheExpiry: number;
  id: string,
  data: string[][]
}



const SHEET_ID = process.env.SHEET_ID;

const login = async () => {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  })
  const service = google.sheets({ version: 'v4', auth });
  return service;
}

const getSheetCache = async (id: string) => {
  const now = Number(new Date());
  try {
    const fyl = await readFile(join(__dirname, 'cache', 'cache.json'), 'utf-8')
    const file: Cache = JSON.parse(fyl);
    if (file.cacheExpiry < now || file.id !== id) {
      return undefined;
    } else {
      return file.data;
    }
  } catch (e) {
    console.error((e as Error).message);
    return undefined;
  }
}

const updateCache = async (id: string, vals: string[][]) => {
  const now = Number(new Date());
  const expiry = Number(new Date(now + 60 * 60 * 1000));
  const cache: Cache = {
    cacheExpiry: expiry,
    id,
    data: vals
  }
  await mkdir(join(__dirname, 'cache'), { recursive: true });

  return writeFile(join(__dirname, 'cache', 'cache.json'), JSON.stringify(cache))
}

const getSheetData = async (id: string) => {
  const cache = await getSheetCache(id);
  if (cache) {
    console.log('cache hit')
    return cache;
  }
  console.log('cache miss')
  const service = await login();
  console.log('logged in')
  const sheetMeta = await service.spreadsheets.get({ spreadsheetId: id });
  const props = sheetMeta.data.sheets?.[0].properties?.gridProperties;
  if (!props) {
    throw Error('what')
  }
  const sheetData = await service.spreadsheets.values.get({ spreadsheetId: id, range: "A1:Z20", majorDimension: 'COLUMNS' });
  if (!sheetData.data.values) {
    throw Error('Sheet contained no data')
  }
  await updateCache(id, sheetData.data.values)
  return sheetData.data.values;
}

const parseTime = (s: string, referenceDate: Date) => {
  try {
    return fromZonedTime(parse(s, 'HH:mm', referenceDate), 'UTC').toISOString()
  } catch (e) {
    console.error((e as Error).message);
    return fromZonedTime(parse(s, 'HH:mm:ss', referenceDate), 'UTC').toISOString()
  }
}

const parseCol = (values: string[]) => {
  const firstBlank = values.findIndex((val) => val === '');
  const now = toZonedTime(new Date(), tz);
  const date = fromZonedTime(parse(values[0], "dd/MM/yy", now), 'UTC')


  const vals = values.slice(1, firstBlank)


  let eventType = EventType.SLEEP;
  let lastTime: string | null = null
  const events: TimeEvent[] = [];

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
    const thisEvent: TimeEvent = {
      time: parseTime(val, date),
      eventType
    }

    events.push(thisEvent)
    if (eventType === EventType.SLEEP) {
      eventType = EventType.WAKE
    } else {
      eventType = EventType.SLEEP
    }

  }

  const day: Day = {
    date: date.toISOString(),
    values: events
  }
  return day;
}

const hasData = (col: string[]) => !!col[0]

const parseCols = (grid: string[][]) => grid.filter(hasData).map(parseCol);

const buildCsv = async (events: TimeEvent[]) => {
  let sleepTime: string | null = null;
  let wakeTime: string | null = null;
  try {
    await mkdir(join(__dirname, 'out'), { recursive: true });
    const fyl = await open(join(__dirname, 'out', 'sleepData.csv'), "w");
    const stream = fyl.createWriteStream();
    stream.write('Sleep,Wake\n');
    if (events[0].eventType === EventType.WAKE) {
      sleepTime = formatInTimeZone(startOfDay(new Date(events[0].time)), tz, "dd/MM/yyyy HH:mm:ss");
    };
    for (const event of events) {
      switch (event.eventType) {
        case EventType.SLEEP: {
          sleepTime = formatInTimeZone(new Date(event.time), "UTC", "dd/MM/yyyy HH:mm:ss");
          break;
        }
        case EventType.WAKE: {
          if (wakeTime) {
            stream.write('\n')
          }
          wakeTime = formatInTimeZone(new Date(event.time), "UTC", "dd/MM/yyyy HH:mm:ss");
          stream.write(`${sleepTime},${wakeTime}`)
          break;
        }
      }
    }

  } catch (e) {
    console.error((e as Error).message);

  }
}

/**
 * Convert the disgusting format of our existing spreadsheet to basic sleep/wake events
 */
const main = async () => {
  if (!SHEET_ID) {
    console.log('Please create a .env file with SHEET_ID=...')
  }

  const result = await getSheetData(SHEET_ID as string);

  const parsedCols = parseCols(result);

  const eventsOnly = parsedCols.flatMap((day) => day.values)

  buildCsv(eventsOnly);
}

main();