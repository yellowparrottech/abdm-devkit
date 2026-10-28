/** The authenticated caller, established by the host application, never by the model. */
export interface Actor {
  id: string;
  /** HIU IDs this actor may request consent for. */
  hiuIds: readonly string[];
}
