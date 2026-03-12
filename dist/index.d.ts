/**
 * Pi Ollama Extension - Working Version
 *
 * Uses same config pattern as local extension
 */
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
interface ModelDetails {
    name: string;
    capabilities?: string[];
    model_info?: Record<string, any>;
    details?: {
        parameter_size?: string;
        family?: string;
        quantization_level?: string;
    };
}
declare function fetchModelDetails(modelName: string): Promise<ModelDetails | null>;
declare function getContextLength(modelInfo: Record<string, any> | undefined): number;
declare function hasVisionCapability(details: ModelDetails): boolean;
declare function hasReasoningCapability(name: string): boolean;
declare function createModel(name: string, isCloud: boolean, details?: ModelDetails): ProviderModelConfig;
declare function fetchLocalModels(): Promise<ProviderModelConfig[]>;
declare function fetchCloudModels(): Promise<ProviderModelConfig[]>;
export default function ollamaExtension(pi: ExtensionAPI): Promise<void>;
export { fetchLocalModels, fetchCloudModels, fetchModelDetails, getContextLength, hasVisionCapability, hasReasoningCapability, createModel, };
//# sourceMappingURL=index.d.ts.map