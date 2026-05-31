export function formatDate(dateStr: string, format: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  
  const yearNum = parseInt(y, 10);
  const monthNum = parseInt(m, 10) - 1; // 0-indexed
  const dayNum = parseInt(d, 10);
  
  if (isNaN(yearNum) || isNaN(monthNum) || isNaN(dayNum)) return dateStr;
  if (monthNum < 0 || monthNum > 11) return dateStr;
  
  const monthNamesAbbr = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  
  const monthNamesFull = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const weekdayNamesAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  const mMMM = monthNamesAbbr[monthNum];
  const mMMMFull = monthNamesFull[monthNum];
  
  const dateObj = new Date(yearNum, monthNum, dayNum);
  const ddd = weekdayNamesAbbr[dateObj.getDay()];
  
  switch (format) {
    case "DD/MM/YYYY":
      return `${d}/${m}/${y}`;
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "DD.MM.YYYY":
      return `${d}.${m}.${y}`;
    case "YYYY/MM/DD":
      return `${y}/${m}/${d}`;
    case "MMM D, YYYY":
      return `${mMMM} ${dayNum}, ${y}`;
    case "D MMM YYYY":
      return `${dayNum} ${mMMM} ${y}`;
    case "MMMM D, YYYY":
      return `${mMMMFull} ${dayNum}, ${y}`;
    case "D MMMM YYYY":
      return `${dayNum} ${mMMMFull} ${y}`;
    case "ddd DD MMM":
      return `${ddd} ${d} ${mMMM}`;
    case "YYYY-MM-DD":
    default:
      return dateStr;
  }
}
