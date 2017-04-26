/**
 * Sleep charter, utility methods
 * Roy Curtis, MIT license, 2017
 */

/**
 * Gets how many minutes have passed in the entire day, of the given date
 *
 * @param {Date} date
 */
function getMinutesOfDay(date)
{
    return (date.getHours() * 60) + date.getMinutes();
}

/**
 * Generates informational message for a given sleep bar
 *
 * @param {SleepBar} sleep
 * @return {string}
 */
function getSleepBarMessage(sleep)
{
    var from    = sleep.from,
        to      = sleep.to,
        minutes = ( to.getTime() - from.getTime() ) / 1000 / 60,
        hours   = (minutes / 60) | 0,
        msg     = "";

    msg += "From: " + sleep.from + "\n";
    msg += "To: " + sleep.to + "\n";
    msg += "Length: " + hours + " hours, ";
    msg += ( minutes - (hours * 60) ) + " minutes";

    return msg;
}

/**
 * Sorts sleep events by earliest from-time to latest from-time
 *
 * @param {SleepEvent} a
 * @param {SleepEvent} b
 * @return {number}
 */
function sortByFromTimes(a, b)
{
    var from = a[0].getTime(),
        to   = b[0].getTime();

    if      (from > to) return 1;
    else if (from < to) return -1;
    else                return 0;
}