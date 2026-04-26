const TZ = "America/Santiago";

export function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

export function dateFromFileId(id: string): string {
  return id.replace(/_\d{2}-\d{2}$/, "");
}

export function allEditionsSidebar(files: string[]): string[] {
  return files;
}

export function formatDateEs(dateStr: string): string {
  const cleanDate = dateFromFileId(dateStr);
  const dt = new Date(cleanDate + "T12:00:00");
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const dateFormatted = `${days[dt.getDay()]} ${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
  const timeMatch = dateStr.match(/_(\d{2})-(\d{2})$/);
  if (timeMatch) return `${dateFormatted} (${timeMatch[1]}:${timeMatch[2]})`;
  return dateFormatted;
}
