export const I_EVENT_PUBLISHER = Symbol('IEventPublisher');

export interface IEventPublisher {
  publish(message: {
    exchange: string;
    routingKey: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<void>;
}
