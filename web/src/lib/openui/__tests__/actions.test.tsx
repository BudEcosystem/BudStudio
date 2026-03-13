/**
 * Tests for the OpenUI canvas action handler.
 *
 * Covers:
 * - continue_conversation: forwards message via sendMessage
 * - copy_to_clipboard: writes text to navigator.clipboard
 * - download with URL: opens a new window
 * - download with inline content: creates blob and triggers anchor click
 * - open_url: opens URL in a new tab
 * - unknown action type: falls through to sendMessage when humanFriendlyMessage is set
 * - unknown action type: does nothing when humanFriendlyMessage is absent
 */

import type { ActionEvent } from "@openuidev/react-lang";
import { handleCanvasAction } from "../actions";

describe("handleCanvasAction", () => {
  let sendMessage: jest.Mock;

  beforeEach(() => {
    sendMessage = jest.fn();
  });

  /* ------------------------------------------------------------------ */
  /*  continue_conversation                                              */
  /* ------------------------------------------------------------------ */

  describe("continue_conversation", () => {
    it("should call sendMessage with humanFriendlyMessage", () => {
      const event: ActionEvent = {
        type: "continue_conversation",
        params: {},
        humanFriendlyMessage: "Tell me more about that",
      };

      handleCanvasAction(event, sendMessage);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith("Tell me more about that");
    });

    it("should fall back to params.message when humanFriendlyMessage is empty", () => {
      const event: ActionEvent = {
        type: "continue_conversation",
        params: { message: "Fallback message" },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith("Fallback message");
    });

    it("should not call sendMessage when both humanFriendlyMessage and params.message are empty", () => {
      const event: ActionEvent = {
        type: "continue_conversation",
        params: {},
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  copy_to_clipboard                                                  */
  /* ------------------------------------------------------------------ */

  describe("copy_to_clipboard", () => {
    let writeTextMock: jest.Mock;

    beforeEach(() => {
      writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });
    });

    it("should write text to the clipboard", () => {
      const event: ActionEvent = {
        type: "copy_to_clipboard",
        params: { text: "copied content" },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith("copied content");
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should handle missing text param gracefully (writes empty string)", () => {
      const event: ActionEvent = {
        type: "copy_to_clipboard",
        params: {},
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(writeTextMock).toHaveBeenCalledWith("");
    });
  });

  /* ------------------------------------------------------------------ */
  /*  download                                                           */
  /* ------------------------------------------------------------------ */

  describe("download", () => {
    it("should open URL when params.url is provided", () => {
      const openMock = jest.fn();
      window.open = openMock;

      const event: ActionEvent = {
        type: "download",
        params: { url: "https://example.com/file.pdf" },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(openMock).toHaveBeenCalledTimes(1);
      expect(openMock).toHaveBeenCalledWith("https://example.com/file.pdf");
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should create a blob download when params.content is provided", () => {
      const clickMock = jest.fn();
      const createElementSpy = jest
        .spyOn(document, "createElement")
        .mockReturnValue({
          href: "",
          download: "",
          click: clickMock,
        } as unknown as HTMLAnchorElement);
      const appendChildSpy = jest
        .spyOn(document.body, "appendChild")
        .mockImplementation((node) => node);
      const removeChildSpy = jest
        .spyOn(document.body, "removeChild")
        .mockImplementation((node) => node);
      const createObjectURLMock = jest.fn().mockReturnValue("blob:mock-url");
      const revokeObjectURLMock = jest.fn();
      URL.createObjectURL = createObjectURLMock;
      URL.revokeObjectURL = revokeObjectURLMock;

      const event: ActionEvent = {
        type: "download",
        params: {
          content: "file contents here",
          filename: "report.txt",
          mimeType: "text/plain",
        },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(createElementSpy).toHaveBeenCalledWith("a");
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(clickMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
      expect(sendMessage).not.toHaveBeenCalled();

      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it("should do nothing when neither url nor content is provided", () => {
      const openMock = jest.fn();
      window.open = openMock;

      const event: ActionEvent = {
        type: "download",
        params: {},
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(openMock).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  open_url                                                           */
  /* ------------------------------------------------------------------ */

  describe("open_url", () => {
    it("should open URL in a new tab with security attributes", () => {
      const openMock = jest.fn();
      window.open = openMock;

      const event: ActionEvent = {
        type: "open_url",
        params: { url: "https://example.com" },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(openMock).toHaveBeenCalledTimes(1);
      expect(openMock).toHaveBeenCalledWith(
        "https://example.com",
        "_blank",
        "noopener,noreferrer"
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("should do nothing when url param is missing", () => {
      const openMock = jest.fn();
      window.open = openMock;

      const event: ActionEvent = {
        type: "open_url",
        params: {},
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(openMock).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  unknown / default action type                                      */
  /* ------------------------------------------------------------------ */

  describe("unknown action type (default branch)", () => {
    it("should forward humanFriendlyMessage via sendMessage for unknown action types", () => {
      const event: ActionEvent = {
        type: "some_custom_action",
        params: { foo: "bar" },
        humanFriendlyMessage: "The user wants to do something custom",
      };

      handleCanvasAction(event, sendMessage);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        "The user wants to do something custom"
      );
    });

    it("should not call sendMessage when humanFriendlyMessage is absent for unknown action", () => {
      const event: ActionEvent = {
        type: "some_custom_action",
        params: { foo: "bar" },
        humanFriendlyMessage: "",
      };

      handleCanvasAction(event, sendMessage);

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
