/** One of the fixed pipeline agents (GET /agents). */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  /** Board card, e.g. "research", "coding". */
  group: string;
}
