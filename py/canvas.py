from .md import *
CATEGORY_TYPE = "🎈LAOGOU/Canvas"

def get_canvas_storage():
    """GetData storage for FastCanvas node"""
    if not hasattr(PromptServer.instance, '_fast_canvas_node_data'):
        PromptServer.instance._fast_canvas_node_data = {}
    return PromptServer.instance._fast_canvas_node_data

def get_refresh_signals():
    """GetRefresh signal cache for FastCanvas node"""
    if not hasattr(PromptServer.instance, '_fast_canvas_refresh_signals'):
        PromptServer.instance._fast_canvas_refresh_signals = {}
    return PromptServer.instance._fast_canvas_refresh_signals

class FastCanvasTool:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bg_img": ("IMAGE",),
            },
            "optional": {
                "img_1": ("IMAGE",),
            }
        }
    RETURN_NAMES = ("fc_data",)
    RETURN_TYPES = ("FC_DATA",)
    FUNCTION = "process_images"
    CATEGORY = CATEGORY_TYPE

    def process_images(self, bg_img, **kwargs):
        canvas_data = {
            "background": None,
            "layers": []
        }
        
        canvas_data["background"] = {
            "id": 0,
            "image": tensor_to_base64(bg_img),
            "is_background": True,
            "size": {
                "height": int(bg_img.shape[1]),
                "width": int(bg_img.shape[2])
            }
        }
        
        for key, value in kwargs.items():
            if value is not None and key.startswith("img_"):
                layer_id = int(key.split('_')[1])
                
                layer_data = {
                    "id": layer_id,
                    "image": tensor_to_base64(value),
                    "is_background": False,
                    "size": {
                        "height": int(value.shape[1]),
                        "width": int(value.shape[2])
                    }
                }
                canvas_data["layers"].append(layer_data)
        
        canvas_data["layers"].sort(key=lambda x: x["id"])
        return (canvas_data,)

def base64_to_tensor(base64_string):
    """Convert base64 image data to tensor"""
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        image_data = base64.b64decode(base64_string)
        
        with BytesIO(image_data) as bio:
            with Image.open(bio) as image:
                if image.mode != 'RGB':
                    image = image.convert('RGB')
                
                # Convert to numpy array并归一化
                image_np = np.array(image).astype(np.float32) / 255.0

                # 处理灰度image
                if image_np.ndim == 2:
                    image_np = np.stack([image_np] * 3, axis=-1)
                # 处理RGBAimage
                elif image_np.shape[2] == 4:
                    image_np = image_np[:, :, :3]

                # Ensureimageformat正确 [B, H, W, C]
                image_np = np.expand_dims(image_np, axis=0)
                tensor = torch.from_numpy(image_np).float()
                print(f"[Tensor Debug] Converted image to tensor: {tensor.shape}")
                return tensor
    
    except Exception as e:
        print(f"[Tensor Error] Failed to convert base64 to tensor: {str(e)}")
        raise

def toBase64ImgUrl(img):
    bytesIO = BytesIO()
    img.save(bytesIO, format="png")
    img_types = bytesIO.getvalue()
    img_base64 = base64.b64encode(img_types)
    return f"data:image/png;base64,{img_base64.decode('utf-8')}"

def tensor_to_base64(tensor):
    if len(tensor.shape) == 3:
        tensor = tensor.unsqueeze(0)
    
    array = (tensor[0].cpu().numpy() * 255).astype(np.uint8)
    
    if array.shape[-1] == 1:
        array = np.repeat(array, 3, axis=-1)
    elif array.shape[-1] == 4:
        # RGBA -> BGRA
        array = array[..., [2,1,0,3]]
    else:
        # RGB -> BGR
        array = array[..., ::-1]
    
    array = np.ascontiguousarray(array)
    
    try:
        success, buffer = cv2.imencode('.png', array)
        if success:
            return f"data:image/png;base64,{base64.b64encode(buffer).decode('utf-8')}"
    except Exception as e:
        print(f"Error encoding image: {e}")
        print(f"Array shape: {array.shape}, dtype: {array.dtype}")
    
    return None



@routes.post("/fast_canvas_all")
async def handle_canvas_data(request):

    data = await request.json()
    node_id = data.get('node_id')
    canvas_storage = get_canvas_storage()
    
    if node_id not in canvas_storage:
        print(f"[FastCanvas] 没有找到等待响应的node")
        return web.Response(status=200)
        
    print(f"[FastCanvas] 成功等待node，准备处理数据")
    transform_data = data.get('layer_transforms', {})
    main_image = array_to_tensor(data.get('main_image'), "image")
    main_mask = array_to_tensor(data.get('main_mask'), "mask")

    processed_data = {
        'image': main_image,
        'mask': main_mask,
        'transform_data': transform_data
    }

    node_info = canvas_storage[node_id]
    node_info["processed_data"] = processed_data
    node_info["event"].set()

    return web.json_response({"status": "success"})

    

@routes.post("/fast_canvas_refresh_signal")
async def handle_refresh_signal(request):

    data = await request.json()
    node_id = data.get('node_id')
    refresh_signals = get_refresh_signals()
    refresh_signals[node_id] = True
    print(f"[FastCanvas] node{node_id}set need_update=True")
    
    return web.json_response({"status": "success"})


class FastCanvas:

    
    def __init__(self):
        self.node_id = None
        self.last_fc_data = None
        self.need_update = False  # Addneed_update变量

    @classmethod
    def clean_nodes(cls):
        """Clean expired nodes"""
        canvas_storage = get_canvas_storage()
        expired_nodes = []
        for node_id, node_info in canvas_storage.items():
            if not node_info["waiting_for_response"]:
                expired_nodes.append(node_id)
        
        for node_id in expired_nodes:
            del canvas_storage[node_id]
    
    @classmethod
    def INPUT_TYPES(cls):

        return {
            "required": {},
            "hidden": {"unique_id": "UNIQUE_ID"},
            "optional": {"fc_data": ("FC_DATA",)}
        }

    RETURN_TYPES = ("IMAGE", "MASK", "TRANSFORM_DATA")
    RETURN_NAMES = ("image", "mask", "transform_data") 
    FUNCTION = "canvas_execute"
    CATEGORY = CATEGORY_TYPE
    OUTPUT_NODE = True

    def canvas_execute(self, unique_id, fc_data=None):
        try:
            self.node_id = unique_id
            
            # 检查refresh signal
            refresh_signals = get_refresh_signals()
            need_update = refresh_signals.pop(unique_id, False)
            
            canvas_storage = get_canvas_storage()
            event = Event()
            
            canvas_storage[unique_id] = {
                "event": event,
                "processed_data": None,
                "waiting_for_response": True
            }
            
            # 根据refresh signal或fc_data决定发送哪种事件
            if need_update or (fc_data is not None and (not hasattr(self, 'last_fc_data') or self.last_fc_data != fc_data)):
                PromptServer.instance.send_sync(
                    "fast_canvas_update", {
                        "node_id": unique_id,
                        "canvas_data": fc_data
                    }
                )
                self.last_fc_data = fc_data
            else:
                PromptServer.instance.send_sync(
                    "fast_canvas_get_state", {
                        "node_id": unique_id
                    }
                )

            if not event.wait(timeout=30):
                if unique_id in canvas_storage:
                    canvas_storage[unique_id]["waiting_for_response"] = False
                FastCanvas.clean_nodes()
                return None, None, None

            node_info = canvas_storage.get(unique_id, {})
            processed_data = node_info.get("processed_data")
            
            if unique_id in canvas_storage:
                canvas_storage[unique_id]["waiting_for_response"] = False
            FastCanvas.clean_nodes()
            
            if processed_data:
                image = processed_data.get('image')
                mask = processed_data.get('mask')
                transform_data = processed_data.get('transform_data', {})
                
                if image is not None:
                    bg_height, bg_width = image.shape[1:3]
                    transform_data['background'] = {
                        'width': bg_width,
                        'height': bg_height
                    }
                
                return image, mask, transform_data
            
            return None, None, None

        except Exception as e:
            print(f"[FastCanvas] Exception occurred during processing: {str(e)}")
            canvas_storage = get_canvas_storage()
            if unique_id in canvas_storage:
                canvas_storage[unique_id]["waiting_for_response"] = False
            FastCanvas.clean_nodes()
            return None, None, None

    def __del__(self):
        # EnsureRemove node data from storage
        canvas_storage = get_canvas_storage()
        if self.node_id and self.node_id in canvas_storage:
            del canvas_storage[self.node_id]


def array_to_tensor(array_data, data_type):

    try:
        if array_data is None:
            return None


        byte_data = bytes(array_data)

        image = Image.open(BytesIO(byte_data))
        
        if data_type == "mask":

            if 'A' in image.getbands():
                mask = np.array(image.getchannel('A')).astype(np.float32) / 255.0
                mask = torch.from_numpy(mask)
            else:
                mask = torch.zeros((image.height, image.width), dtype=torch.float32)
            return mask.unsqueeze(0)
            
        elif data_type == "image":
            if image.mode != 'RGB':
                image = image.convert('RGB')

            image = np.array(image).astype(np.float32) / 255.0
            return torch.from_numpy(image)[None,] 

        return None

    except Exception as e:
        print(f"[FastCanvas] Error in array_to_tensor: {str(e)}")
        return None



class FastCanvasComposite:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bg_img": ("IMAGE",),
                "image": ("IMAGE",),
                "mask": ("MASK",),
                "transform_data": ("TRANSFORM_DATA",),
                "invert_mask": ("BOOLEAN", {"default": False}), 
                "mode": ("BOOLEAN", {
                    "default": False, 
                    "label_on": "HD Restore", 
                    "label_off": "Inherit Mode"
                }),
                "offset_x": ("INT", {"default": 0, "min": -1000, "max": 1000, "step": 1}),  # Add X-axis offset
                "offset_y": ("INT", {"default": 0, "min": -1000, "max": 1000, "step": 1}),  # Add Y-axis offset
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "composite"
    CATEGORY = CATEGORY_TYPE

    def tensor2pil(self, tensor):
        # Ensure tensor is [H, W, C] format
        if len(tensor.shape) == 4:
            tensor = tensor[0]  # remove batch dimension
        # Convert to 0-255 range
        tensor = (tensor * 255).byte()
        # Convert to PIL image
        return Image.fromarray(tensor.cpu().numpy())

    def pil2tensor(self, image):
        # Convert to numpy array
        np_image = np.array(image).astype(np.float32) / 255.0
        # Convert to tensor and add batch dimension
        return torch.from_numpy(np_image).unsqueeze(0)

    def calculate_hd_scale(self, transform_data, fg_width, fg_height):
        """Compute scaling factor for HD restore mode"""
        # Get layer data
        layer_data = next(trans for key, trans in transform_data.items() if key != 'background')
        
        # Compute transformed size
        transformed_width = layer_data['width'] * layer_data['scaleX']
        transformed_height = layer_data['height'] * layer_data['scaleY']
        
        # Compute upscale factor
        scale_x = fg_width / transformed_width
        scale_y = fg_height / transformed_height
        
        return min(scale_x, scale_y)
    def scale_hd_transform(self, transform_data, scale):
        """AdjustHD restore mode的transform data"""
        new_data = {'background': transform_data['background']}
        
        # Get并处理layer data（排除background后只剩一个）
        layer_id = next(key for key in transform_data.keys() if key != 'background')
        layer_data = transform_data[layer_id]
        
        new_data[layer_id] = {
            'centerX': layer_data['centerX'] * scale,
            'centerY': layer_data['centerY'] * scale,
            'scaleX': layer_data['scaleX'] * scale,
            'scaleY': layer_data['scaleY'] * scale,
            'angle': layer_data['angle'],
            'width': layer_data['width'],
            'height': layer_data['height'],
            'flipX': layer_data['flipX'],
            'flipY': layer_data['flipY']
        }
        
        return new_data


    def composite(self, bg_img, image, mask, transform_data, mode=False, invert_mask=False, offset_x=0, offset_y=0):
        try:
            # Ensure所有输入都是批次format [B, H, W, C] 或 [B, H, W]
            if bg_img.dim() == 3:
                bg_img = bg_img.unsqueeze(0)
            if image.dim() == 3:
                image = image.unsqueeze(0)
            if mask.dim() == 2:
                mask = mask.unsqueeze(0)
            
            # 如果输入是 [B, C, H, W] format，Convert to [B, H, W, C]
            if bg_img.shape[1] == 3 or bg_img.shape[1] == 4:
                bg_img = bg_img.permute(0, 2, 3, 1)
            if image.shape[1] == 3 or image.shape[1] == 4:
                image = image.permute(0, 2, 3, 1)
            
            # Get批次大小
            batch_size = bg_img.shape[0]
            
            # 创建结果列表
            result_tensors = []
            mask_tensors = []
            
            # Process each batch
            for i in range(batch_size):
                # 转换当前批次的image到PILformat
                bg_pil = self.tensor2pil(bg_img[i:i+1])
                fg_pil = self.tensor2pil(image[i:i+1])
                
                # Get当前批次的transform_data
                current_transform = transform_data[i] if isinstance(transform_data, list) else transform_data
                
                # Get原始目标尺寸
                target_width = current_transform['background']['width']
                target_height = current_transform['background']['height']
                
                # 处理HD restore mode
                if mode:
                    scale = self.calculate_hd_scale(current_transform, fg_pil.width, fg_pil.height)
                    target_width = round(target_width * scale)
                    target_height = round(target_height * scale)
                    current_transform = self.scale_hd_transform(current_transform, scale)

                # 将背景图片缩放到目标尺寸
                bg_pil = bg_pil.resize((target_width, target_height), Image.LANCZOS)
                
                # 处理Mask
                current_mask = mask[i] if mask.dim() == 3 else mask[i:i+1]
                mask_pil = Image.fromarray((current_mask.cpu().numpy() * 255).astype(np.uint8), 'L')
                
                if invert_mask:
                    mask_pil = ImageOps.invert(mask_pil)
                
                # Create result canvas
                result = bg_pil.copy()
                result_mask = Image.new('L', bg_pil.size, 0)

                # 处理每个transform data
                for layer_id, trans in current_transform.items():
                    if layer_id == 'background':
                        continue
                    
                    # Get原始尺寸
                    orig_width = trans.get('width', fg_pil.width)
                    orig_height = trans.get('height', fg_pil.height)
                    
                    # Get变换参数
                    scale_x = trans.get('scaleX', 1)
                    scale_y = trans.get('scaleY', 1)
                    angle = trans.get('angle', 0)
                    center_x = trans.get('centerX', 0)
                    center_y = trans.get('centerY', 0)
                    flip_x = trans.get('flipX', False)
                    flip_y = trans.get('flipY', False)
                    
                    # 计算实际尺寸
                    new_width = int(orig_width * scale_x)
                    new_height = int(orig_height * scale_y)
                    
                    # 缩放image和Mask
                    transformed_fg = fg_pil.resize((new_width, new_height), Image.LANCZOS)
                    transformed_mask = mask_pil.resize((new_width, new_height), Image.LANCZOS)
                    
                    # 处理翻转
                    if flip_x:
                        transformed_fg = transformed_fg.transpose(Image.FLIP_LEFT_RIGHT)
                        transformed_mask = transformed_mask.transpose(Image.FLIP_LEFT_RIGHT)
                    if flip_y:
                        transformed_fg = transformed_fg.transpose(Image.FLIP_TOP_BOTTOM)
                        transformed_mask = transformed_mask.transpose(Image.FLIP_TOP_BOTTOM)
                    
                    # 处理旋转
                    if angle != 0:
                        transformed_fg = transformed_fg.rotate(-angle, expand=True, resample=Image.BICUBIC)
                        transformed_mask = transformed_mask.rotate(-angle, expand=True, resample=Image.BICUBIC)
                    
                    # Get最终尺寸
                    current_width = transformed_fg.width
                    current_height = transformed_fg.height
                    
                    # 计算粘贴位置（Add偏移量）
                    paste_x = int(center_x - current_width / 2) + offset_x
                    paste_y = int(center_y - current_height / 2) + offset_y
                    
                    # 合成image
                    result.paste(transformed_fg, (paste_x, paste_y), transformed_mask)
                    result_mask.paste(transformed_mask, (paste_x, paste_y))
                
                # 将处理后的结果Add到列表中
                result_tensors.append(self.pil2tensor(result))
                mask_tensor = torch.from_numpy(np.array(result_mask)).float() / 255.0
                mask_tensors.append(mask_tensor.unsqueeze(0))
            
            # Concatenate batch results
            final_result = torch.cat(result_tensors, dim=0)
            final_mask = torch.cat(mask_tensors, dim=0)
            
            return (final_result, final_mask)

        except Exception as e:
            print(f"Synthesis failed: {str(e)}")
            print(f"Background image shape: {bg_img.shape}")
            print(f"Foreground image shape: {image.shape}")
            print(f"Mask shape: {mask.shape}")
            import traceback
            traceback.print_exc()
            return (bg_img, torch.ones_like(mask[0]))


NODE_CLASS_MAPPINGS = {
    "FastCanvasTool": FastCanvasTool,
    "FastCanvas": FastCanvas,
    "FastCanvasComposite": FastCanvasComposite,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FastCanvasTool": "🎈FastCanvasTool",
    "FastCanvas": "🎈FastCanvas",
    "FastCanvasComposite": "🎈FastCanvasComposite",
} 
