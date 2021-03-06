import { GuildPluginData } from "knub";
import { LogsPluginType, TLogChannelMap } from "../types";
import { LogType } from "../../../data/LogType";
import { TextChannel } from "eris";
import { createChunkedMessage, noop } from "../../../utils";
import { getLogMessage } from "./getLogMessage";
import { allowTimeout } from "../../../RegExpRunner";

const excludedUserProps = ["user", "member", "mod"];

export async function log(pluginData: GuildPluginData<LogsPluginType>, type: LogType, data: any) {
  const logChannels: TLogChannelMap = pluginData.config.get().channels;
  const typeStr = LogType[type];

  logChannelLoop: for (const [channelId, opts] of Object.entries(logChannels)) {
    const channel = pluginData.guild.channels.get(channelId);
    if (!channel || !(channel instanceof TextChannel)) continue;

    if ((opts.include && opts.include.includes(typeStr)) || (opts.exclude && !opts.exclude.includes(typeStr))) {
      // If this log entry is about an excluded user, skip it
      // TODO: Quick and dirty solution, look into changing at some point
      if (opts.excluded_users) {
        for (const prop of excludedUserProps) {
          if (data && data[prop] && opts.excluded_users.includes(data[prop].id)) {
            continue logChannelLoop;
          }
        }
      }

      // If we're excluding bots and the logged user is a bot, skip it
      if (opts.exclude_bots) {
        for (const prop of excludedUserProps) {
          if (data && data[prop] && data[prop].bot) {
            continue logChannelLoop;
          }
        }
      }

      // If this entry is from an excluded channel, skip it
      if (opts.excluded_channels) {
        if (
          type === LogType.MESSAGE_DELETE ||
          type === LogType.MESSAGE_DELETE_BARE ||
          type === LogType.MESSAGE_EDIT ||
          type === LogType.MESSAGE_SPAM_DETECTED ||
          type === LogType.CENSOR ||
          type === LogType.CLEAN
        ) {
          if (opts.excluded_channels.includes(data.channel.id)) {
            continue logChannelLoop;
          }
        }
      }

      // If this entry is from an excluded category, skip it
      if (opts.excluded_categories) {
        if (
          type === LogType.MESSAGE_DELETE ||
          type === LogType.MESSAGE_DELETE_BARE ||
          type === LogType.MESSAGE_EDIT ||
          type === LogType.MESSAGE_SPAM_DETECTED ||
          type === LogType.CENSOR ||
          type === LogType.CLEAN
        ) {
          if (data.channel.parentID && opts.excluded_categories.includes(data.channel.parentID)) {
            continue logChannelLoop;
          }
        }
      }

      // If this entry contains a message with an excluded regex, skip it
      if (type === LogType.MESSAGE_DELETE && opts.excluded_message_regexes && data.message.data.content) {
        for (const regex of opts.excluded_message_regexes) {
          const matches = await pluginData.state.regexRunner.exec(regex, data.message.data.content).catch(allowTimeout);
          if (matches) {
            continue logChannelLoop;
          }
        }
      }

      if (type === LogType.MESSAGE_EDIT && opts.excluded_message_regexes && data.before.data.content) {
        for (const regex of opts.excluded_message_regexes) {
          const matches = await pluginData.state.regexRunner.exec(regex, data.before.data.content).catch(allowTimeout);
          if (matches) {
            continue logChannelLoop;
          }
        }
      }

      const message = await getLogMessage(pluginData, type, data, {
        format: opts.format,
        include_embed_timestamp: opts.include_embed_timestamp,
        timestamp_format: opts.timestamp_format,
      });

      if (message) {
        // For non-string log messages (i.e. embeds) batching or chunking is not possible, so send them immediately
        if (typeof message !== "string") {
          await channel.createMessage(message).catch(noop);
          return;
        }

        // Default to batched unless explicitly disabled
        const batched = opts.batched ?? true;
        const batchTime = opts.batch_time ?? 1000;
        const cfg = pluginData.config.get();

        if (batched) {
          // If we're batching log messages, gather all log messages within the set batch_time into a single message
          if (!pluginData.state.batches.has(channel.id)) {
            pluginData.state.batches.set(channel.id, []);
            setTimeout(async () => {
              const batchedMessage = pluginData.state.batches.get(channel.id)!.join("\n");
              pluginData.state.batches.delete(channel.id);
              createChunkedMessage(channel, batchedMessage, { users: cfg.allow_user_mentions }).catch(noop);
            }, batchTime);
          }

          pluginData.state.batches.get(channel.id)!.push(message);
        } else {
          // If we're not batching log messages, just send them immediately
          await createChunkedMessage(channel, message, { users: cfg.allow_user_mentions }).catch(noop);
        }
      }
    }
  }
}
