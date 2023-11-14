import ChatAbilityBase from "../../spellbook/prompt/chat.ability.base";
import {
  AbilityResponseHelperInterface,
  AmqpGolemMessage,
  AsyncJob,
  ChatAbilityInterface,
  LoggerServiceInterface,
  ServicesConstructorInterface,
  SocketMessage,
  SpellbookServiceInterface,
  VaultServiceInterface,
  WorkspaceServiceInterface,
} from "types";

class ImageGeneratorSkill
  extends ChatAbilityBase
  implements ChatAbilityInterface
{
  private spellbookService: SpellbookServiceInterface;
  private vaultService: VaultServiceInterface;
  private workspaceService: WorkspaceServiceInterface;
  private responseClass: AbilityResponseHelperInterface;
  private runningJobs: Map<string, AsyncJob>;

  constructor(services: ServicesConstructorInterface) {
    super(services);
    this.spellbookService = services["SpellbookService"];
    this.vaultService = services["VaultService"];
    this.workspaceService = services["WorkspaceService"];
    this.runningJobs = new Map();
  }

  async handleWav(message: AmqpGolemMessage): Promise<boolean> {
    const headers = message.properties.headers;
    const socketId = headers.socket_id;
    if (!headers.success) {
      await this.responseClass.sendError(
        headers.errors.join("<br/>"),
        headers.socket_id
      );

      const job = this.runningJobs.get(socketId);
      job.resolve(true);
      this.runningJobs.delete(socketId);
      return true;
    }

    const content = JSON.parse(message.content);
    const wavBuffer = Buffer.from(content.wav, "base64");
    const fileName = await this.workspaceService.getNextFile(
      socketId,
      "music-",
      "wav"
    );
    const filePath = await this.workspaceService.saveFile(
      socketId,
      fileName,
      wavBuffer
    );
    this.logger.info(`wav file saved to ${filePath} for ${socketId}`, {
      icon: "🎶",
    });

    const baseUrl = this.vaultService.getBaseUrl();
    const html = `<div class="card p-0 audio-card" style="background-image: url('${baseUrl}asset/chat-ability/music-generator/music-background.jpg');">
        <div class="align-content-center pt-1 pb-2">
          <audio controls style="margin: auto; display: block">
              <source src="${baseUrl}${filePath}" type="audio/wav">
              Your browser does not support the audio element.
          </audio>                    
        </div>                
      </div>
      <p style="width: 100%; text-align: center; font-weight: 600" class="text-l">${fileName}</p>`;

    await this.responseClass.sendResponse(html, null, socketId);
    const job = this.runningJobs.get(socketId);
    job.resolve(true);
    this.runningJobs.delete(socketId);
    return true;
  }

  async executeSkill(
    socketMessage: SocketMessage,
    skillData: any,
    responseClass: AbilityResponseHelperInterface
  ): Promise<boolean> {
    this.responseClass = responseClass;
    if (!socketMessage) return false;

    const musicGenerators =
      this.spellbookService.getOnlineSkillFromType("music_generation");
    if (!musicGenerators) {
      await responseClass.sendError(
        `No music generators are currently running.`,
        socketMessage.socket_id
      );
      this.logger.error(`no music generators are loaded`);
      return false;
    }
    const useSkill = musicGenerators[0];

    // build the payload from config settings
    const skillConfig = await this.vaultService.getGroup(
      "chat_ability/music_generation"
    );
    const payload = !skillConfig
      ? {
          length_in_seconds: 10,
          guidance_scale: 3,
        }
      : skillConfig;

    // override defaults w/ user provided parameters
    payload.prompt = skillData.prompt;
    payload.length_in_seconds = skillData.length_in_seconds
      ? skillData.length_in_seconds
      : payload.length_in_seconds;
    payload.length_in_seconds =
      payload.length_in_seconds > 30 ? 30 : payload.length_in_seconds;
    payload.guidance_scale = skillData.guidance_scale
      ? skillData.guidance_scale
      : payload.guidance_scale;
    payload.guidance_scale =
      payload.guidance_scale > 5 ? 5 : payload.guidance_scale;
    payload.seconds = payload.length_in_seconds;
    payload.progress = true;
    delete payload.length_in_seconds;

    return new Promise(async (resolve, reject) => {
      this.runningJobs.set(socketMessage.socket_id, {
        resolve: resolve,
        reject: reject,
      });
      await this.spellbookService.publishCommand(
        "golem_skill",
        useSkill,
        "generate_music_wav",
        payload,
        {
          socket_id: socketMessage.socket_id,
        }
      );
    });
  }
}

export default ImageGeneratorSkill;
