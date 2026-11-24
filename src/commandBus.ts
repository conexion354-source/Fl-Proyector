/**
 * Pedidos entre pantallas (por ejemplo, la búsqueda Ctrl+K pide abrir una
 * canción). Como las páginas se montan al entrar, el pedido queda guardado
 * hasta que la página lo toma.
 */
export type CommandRequest =
  | { kind: "open-song"; songId: number }
  | { kind: "bible-search"; query: string };

const pending = new Map<CommandRequest["kind"], CommandRequest>();
const eventName = "fl:command-request";

export function sendCommand(request: CommandRequest) {
  pending.set(request.kind, request);
  window.dispatchEvent(new CustomEvent(eventName, { detail: request.kind }));
}

export function takeCommand<K extends CommandRequest["kind"]>(kind: K) {
  const request = pending.get(kind) as Extract<CommandRequest, { kind: K }> | undefined;
  pending.delete(kind);
  return request;
}

/** Llama a `handler` con el pedido pendiente al montar y con cada pedido nuevo. */
export function onCommand<K extends CommandRequest["kind"]>(
  kind: K,
  handler: (request: Extract<CommandRequest, { kind: K }>) => void,
) {
  const check = () => {
    const request = takeCommand(kind);
    if (request) handler(request);
  };
  check();
  const listener = (event: Event) => {
    if ((event as CustomEvent).detail === kind) check();
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
