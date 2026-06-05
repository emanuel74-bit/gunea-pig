export const I_STORAGE = Symbol('IStoragePort');

export interface IStoragePort {
  putJson(target: { bucket: string; key: string }, payload: unknown): Promise<void>;
  getJson<T>(target: { bucket: string; key: string }): Promise<T>;
  headObject(target: { bucket: string; key: string }): Promise<unknown>;
  downloadToFile(target: { bucket: string; key: string }, destinationPath: string): Promise<void>;
}
