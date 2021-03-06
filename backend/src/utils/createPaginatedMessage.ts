import { Client, Emoji, MemberPartial, Message, MessageContent, TextableChannel } from "eris";
import { Awaitable } from "knub/dist/utils";
import { MINUTES, noop } from "../utils";
import Timeout = NodeJS.Timeout;

export type LoadPageFn = (page: number) => Awaitable<MessageContent>;

export interface PaginateMessageOpts {
  timeout: number;
  limitToUserId: string | null;
}

const defaultOpts: PaginateMessageOpts = {
  timeout: 5 * MINUTES,
  limitToUserId: null,
};

export async function createPaginatedMessage(
  client: Client,
  channel: TextableChannel,
  totalPages: number,
  loadPageFn: LoadPageFn,
  opts: Partial<PaginateMessageOpts> = {},
): Promise<Message> {
  const fullOpts = { ...defaultOpts, ...opts } as PaginateMessageOpts;
  const firstPageContent = await loadPageFn(1);
  const message = await channel.createMessage(firstPageContent);

  let page = 1;
  let pageLoadId = 0; // Used to avoid race conditions when rapidly switching pages
  const reactionListener = async (reactionMessage: Message, emoji: Emoji, reactor: MemberPartial) => {
    if (reactionMessage.id !== message.id) {
      return;
    }

    if (fullOpts.limitToUserId && reactor.id !== fullOpts.limitToUserId) {
      return;
    }

    if (reactor.id === client.user.id) {
      return;
    }

    let pageDelta = 0;
    if (emoji.name === "⬅️") {
      pageDelta = -1;
    } else if (emoji.name === "➡️") {
      pageDelta = 1;
    }

    if (!pageDelta) {
      return;
    }

    const newPage = Math.max(Math.min(page + pageDelta, totalPages), 1);
    if (newPage === page) {
      return;
    }

    page = newPage;
    const thisPageLoadId = ++pageLoadId;
    const newPageContent = await loadPageFn(page);
    if (thisPageLoadId !== pageLoadId) {
      return;
    }

    message.edit(newPageContent).catch(noop);
    message.removeReaction(emoji.name, reactor.id);
    refreshTimeout();
  };
  client.on("messageReactionAdd", reactionListener);

  // The timeout after which reactions are removed and the pagination stops working
  // is refreshed each time the page is changed
  let timeout: Timeout;
  const refreshTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      message.removeReactions().catch(noop);
      client.off("messageReactionAdd", reactionListener);
    }, fullOpts.timeout);
  };

  refreshTimeout();

  // Add reactions
  message.addReaction("⬅️").catch(noop);
  message.addReaction("➡️").catch(noop);

  return message;
}
