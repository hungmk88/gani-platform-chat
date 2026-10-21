/** Packets for the sockets of /agent (realtime spec §3); `emit` resolves once Valkey has the packet, and throws when it does not. */
export interface AgentEmitter {
  emit(rooms: readonly string[], event: string, packet: unknown): Promise<void>;
  close(): Promise<void>;
}
