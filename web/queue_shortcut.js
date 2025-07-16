import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

class EventManager {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  removeEventListener(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  dispatchEvent(event, detail = {}) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      callbacks.forEach(callback => {
        try {
          callback({ detail });
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}

class QueueManager {
  constructor() {
    this.eventManager = new EventManager();
    this.queueNodeIds = null;
    this.processingQueue = false;
    this.lastAdjustedMouseEvent = null;
    this.initializeHooks();
  }

  initializeHooks() {
    const originalQueuePrompt = app.queuePrompt;
    const originalGraphToPrompt = app.graphToPrompt;
    const originalApiQueuePrompt = api.queuePrompt;

    app.queuePrompt = async function() {
      this.processingQueue = true;
      this.eventManager.dispatchEvent("queue");
      try {
        await originalQueuePrompt.apply(app, [...arguments]);
      } finally {
        this.processingQueue = false;
        this.eventManager.dispatchEvent("queue-end");
      }
    }.bind(this);

    app.graphToPrompt = async function() {
      this.eventManager.dispatchEvent("graph-to-prompt");
      let promise = originalGraphToPrompt.apply(app, [...arguments]);
      await promise;
      this.eventManager.dispatchEvent("graph-to-prompt-end");
      return promise;
    }.bind(this);

    api.queuePrompt = async function(index, prompt) {
      if (this.queueNodeIds && this.queueNodeIds.length && prompt.output) {
        const oldOutput = prompt.output;
        let newOutput = {};
        for (const queueNodeId of this.queueNodeIds) {
          this.recursiveAddNodes(String(queueNodeId), oldOutput, newOutput);
        }
        prompt.output = newOutput;
      }
      this.eventManager.dispatchEvent("comfy-api-queue-prompt-before", {
        workflow: prompt.workflow,
        output: prompt.output,
      });
      const response = originalApiQueuePrompt.apply(api, [index, prompt]);
      this.eventManager.dispatchEvent("comfy-api-queue-prompt-end");
      return response;
    }.bind(this);

    const originalProcessMouseDown = LGraphCanvas.prototype.processMouseDown;
    const originalAdjustMouseEvent = LGraphCanvas.prototype.adjustMouseEvent;
    const originalProcessMouseMove = LGraphCanvas.prototype.processMouseMove;

    LGraphCanvas.prototype.processMouseDown = function(e) {
      const result = originalProcessMouseDown.apply(this, [...arguments]);
      queueManager.lastAdjustedMouseEvent = e;
      return result;
    };

    LGraphCanvas.prototype.adjustMouseEvent = function(e) {
      originalAdjustMouseEvent.apply(this, [...arguments]);
      queueManager.lastAdjustedMouseEvent = e;
    };

    LGraphCanvas.prototype.processMouseMove = function(e) {
      const result = originalProcessMouseMove.apply(this, [...arguments]);
      if (e && !e.canvasX && !e.canvasY) {
        const canvas = app.canvas;
        const offset = canvas.convertEventToCanvasOffset(e);
        e.canvasX = offset[0];
        e.canvasY = offset[1];
      }
      queueManager.lastAdjustedMouseEvent = e;
      return result;
    };
  }
  recursiveAddNodes(nodeId, oldOutput, newOutput) {
    let currentId = nodeId;
    let currentNode = oldOutput[currentId];
    if (newOutput[currentId] == null) {
      newOutput[currentId] = currentNode;
      for (const inputValue of Object.values(currentNode.inputs || [])) {
        if (Array.isArray(inputValue)) {
          this.recursiveAddNodes(inputValue[0], oldOutput, newOutput);
        }
      }
    }
    return newOutput;
  }
  async queueOutputNodes(nodeIds) {
    try {
      this.queueNodeIds = nodeIds;
      await app.queuePrompt();
    } catch (e) {
      console.error("队列节点时出错:", e);
    } finally {
      this.queueNodeIds = null;
    }
  }
  getLastMouseEvent() {
    return this.lastAdjustedMouseEvent;
  }
  addEventListener(event, callback) {
    this.eventManager.addEventListener(event, callback);
  }
  removeEventListener(event, callback) {
    this.eventManager.removeEventListener(event, callback);
  }
}

function getOutputNodes(nodes) {
  return (nodes?.filter((n) => {
    return (n.mode != LiteGraph.NEVER &&
      n.constructor.nodeData?.output_node);
  }) || []);
}
const queueManager = new QueueManager();
function queueSelectedOutputNodes() {
  const selectedNodes = app.canvas.selected_nodes;
  if (!selectedNodes || Object.keys(selectedNodes).length === 0) {
    console.log("[LG]队列: 没有选中的节点");
    return;
  }

  const outputNodes = getOutputNodes(Object.values(selectedNodes));
  if (!outputNodes || outputNodes.length === 0) {
    console.log("[LG]队列: 选中的节点中没有输出节点");
    return;
  }

  console.log(`[LG]队列: 执行 ${outputNodes.length} 个输出节点`);
  queueManager.queueOutputNodes(outputNodes.map((n) => n.id));
}

function queueGroupOutputNodes() {
  const lastMouseEvent = queueManager.getLastMouseEvent();
  if (!lastMouseEvent) {
    return;
  }

  let canvasX = lastMouseEvent.canvasX;
  let canvasY = lastMouseEvent.canvasY;
  
  if (!canvasX || !canvasY) {
    const canvas = app.canvas;
    const mousePos = canvas.getMousePos();
    canvasX = mousePos[0];
    canvasY = mousePos[1];
  }

  const group = app.graph.getGroupOnPos(canvasX, canvasY);

  if (!group) {
    return;
  }

  group.recomputeInsideNodes();

  if (!group._nodes || group._nodes.length === 0) {
    return;
  }
  
  const outputNodes = getOutputNodes(group._nodes);
  if (!outputNodes || outputNodes.length === 0) {
    return;
  }

  queueManager.queueOutputNodes(outputNodes.map((n) => n.id));
}

app.registerExtension({
  name: "LG.QueueNodes",
  commands: [
    {
      id: "LG.QueueSelectedOutputNodes",
      icon: "pi pi-play",
      label: "执行选中的输出节点",
      function: queueSelectedOutputNodes
    },
    {
      id: "LG.QueueGroupOutputNodes", 
      icon: "pi pi-sitemap",
      label: "执行组内输出节点",
      function: queueGroupOutputNodes
    }
  ]
});

export { queueManager, getOutputNodes, queueSelectedOutputNodes, queueGroupOutputNodes }; 


// 打开选中节点的遮罩编辑器
function openMaskEditorForSelectedNode() {
  const selectedNodes = app.canvas.selected_nodes;
  if (!selectedNodes || Object.keys(selectedNodes).length === 0) {
      app.ui.dialog.show("请先选中一个节点");
      return;
  }
  
  // 获取第一个选中的节点
  const nodeId = Object.keys(selectedNodes)[0];
  const node = selectedNodes[nodeId];
  
  if (!node) {
      app.ui.dialog.show("未找到选中的节点");
      return;
  }
  
  // 检查节点是否有图像数据
  let images = [];
  let imgs = [];
  
  if (node.imgs && node.imgs.length > 0) {
      // 使用节点现有的图像
      imgs = node.imgs.map((img, index) => ({
          src: img.src,
          filename: node.imageData?.[index]?.filename || `image_${index}.png`,
          subfolder: node.imageData?.[index]?.subfolder || "",
          type: node.imageData?.[index]?.type || "output"
      }));
      
      images = imgs.map(img => ({
          filename: img.filename,
          subfolder: img.subfolder,
          type: img.type
      }));
  } else if (node.images && node.images.length > 0) {
      // 使用节点的images属性
      images = node.images.map(img => ({
          filename: img.filename,
          subfolder: img.subfolder || "",
          type: img.type || "output"
      }));
      
      imgs = images.map(img => ({
          src: img.url || `/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`,
          filename: img.filename,
          subfolder: img.subfolder,
          type: img.type
      }));
  } else {
      app.ui.dialog.show("选中的节点没有可用的图像数据");
      return;
  }
  
  // 设置clipspace
  const ComfyApp = app.constructor;
  if (!ComfyApp.clipspace) ComfyApp.clipspace = {};
  if (!app.clipspace) app.clipspace = {};
  
  [ComfyApp.clipspace, app.clipspace].forEach(clipspace => {
      clipspace.images = images;
      clipspace.imgs = imgs;
      clipspace.selectedIndex = 0;
  });
  
  // 打开遮罩编辑器
  setTimeout(() => {
      const openMaskEditor = ComfyApp.open_maskeditor || app.open_maskeditor;
      if (openMaskEditor) {
          openMaskEditor();
          bindCancelButton();
      } else {
          app.ui.dialog.show("无法找到遮罩编辑器功能");
      }
  }, 100);
}

// 注册快捷键扩展
app.registerExtension({
  name: "LG.OpenMaskEditorShortcut",
  commands: [
      {
          id: "LG.OpenMaskEditorForSelected",
          icon: "pi pi-pencil",
          label: "打开选中节点的遮罩编辑器",
          function: openMaskEditorForSelectedNode
      }
  ]
});