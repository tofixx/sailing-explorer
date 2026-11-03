// Fehler mit HTTP-Status und Code – ohne Worker-Typen, damit reine Module wie validate.ts ihn werfen können;
// worker/http.ts reicht ihn weiter (errorResponse wandelt ihn in die JSON-Antwort).
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
