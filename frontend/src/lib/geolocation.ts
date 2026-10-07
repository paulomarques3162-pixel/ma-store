/**
 * Geolocalização do entregador.
 *
 * Registramos a localização apenas em EVENTOS importantes (início, confirmação,
 * falha) — nunca rastreamento contínuo. Se o usuário negar a permissão, a
 * operação NÃO é bloqueada: retornamos `null` e o backend registra a entrega
 * sem coordenadas.
 */
export type GeoPoint = { latitude: number; longitude: number; locationAccuracy: number | null };

export async function getCurrentLocation(timeoutMs = 8000): Promise<GeoPoint | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: GeoPoint | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => done(null), timeoutMs + 500);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        done({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          locationAccuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
