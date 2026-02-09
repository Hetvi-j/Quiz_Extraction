#!/usr/bin/env python3
"""
Handwritten Text OCR Model Training Script
Using TrOCR (Transformer-based Optical Character Recognition)
"""

import os
import torch
import pandas as pd
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import (
    TrOCRProcessor, 
    VisionEncoderDecoderModel,
    Trainer,
    TrainingArguments,
    VisionEncoderDecoderConfig,
)
import evaluate
import numpy as np
import torch


import torch
from transformers import Trainer

class CustomTrainer(Trainer):
    """
    Custom Trainer that tolerates the extra positional `num_items_in_batch`
    argument and does minimal intervention.
    """
    def training_step(self, model, inputs, num_items_in_batch=None):
        # Optionally: preprocess inputs if needed (e.g., label masking)
        # NOTE: the default Trainer already handles gradient scaling/accumulation,
        # so we delegate most work to it by calling the model and returning loss.

        model.train()
        outputs = model(**inputs)
        loss = outputs.loss

        return loss

class CustomDataCollator:
    def __init__(self, processor):
        self.processor = processor

    def __call__(self, batch):
        pixel_values = torch.stack([item["pixel_values"] for item in batch])
        labels = torch.stack([item["labels"] for item in batch])
        
        # Ensure labels are padded correctly and any -100 values are set for loss calculation
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {
            "pixel_values": pixel_values,
            "labels": labels
        }
class HandwritingDataset(Dataset):
    """Custom dataset for handwritten text images and labels"""
    
    def __init__(self, images, texts, processor, max_target_length=128):
        self.images = images
        self.texts = texts
        self.processor = processor
        self.max_target_length = max_target_length
    
    def __len__(self):
        return len(self.images)
    
    def __getitem__(self, idx):
        # Load and process image
        image = Image.open(self.images[idx]).convert('RGB')
        text = self.texts[idx]
        
        # Process image and text
        pixel_values = self.processor(image, return_tensors="pt").pixel_values
        labels = self.processor.tokenizer(
            text,
            padding="max_length",
            max_length=self.max_target_length,
            truncation=True,
            return_tensors="pt"
        ).input_ids
        
        return {
            "pixel_values": pixel_values.squeeze(),
            "labels": labels.squeeze()
        }

def load_dataset(data_dir):
    """
    Load dataset from directory structure:
    data_dir/
    ├── images/
    │   ├── image1.jpg
    │   ├── image2.png
    │   └── ...
    └── labels.csv (columns: filename, text)
    """
    labels_df = pd.read_csv(os.path.join(data_dir, 'labels.csv'))
    
    images = []
    texts = []
    
    for _, row in labels_df.iterrows():
        image_path = os.path.join(data_dir, 'images', row['filename'])
        if os.path.exists(image_path):
            images.append(image_path)
            texts.append(row['text'])
    
    return images, texts

def compute_metrics(eval_pred):
    """Compute CER (Character Error Rate) and WER (Word Error Rate)"""
    predictions, labels = eval_pred
    
    # Decode predictions and labels
    decoded_preds = processor.batch_decode(predictions, skip_special_tokens=True)
    labels = np.where(labels != -100, labels, processor.tokenizer.pad_token_id)
    decoded_labels = processor.batch_decode(labels, skip_special_tokens=True)
    
    # Compute CER
    cer_metric = evaluate.load("cer")
    cer = cer_metric.compute(predictions=decoded_preds, references=decoded_labels)
    
    # Compute WER  
    wer_metric = evaluate.load("wer")
    wer = wer_metric.compute(predictions=decoded_preds, references=decoded_labels)
    
    return {"cer": cer, "wer": wer}

def train_model(
    train_data_dir,
    val_data_dir,
    output_dir="./handwriting-ocr-model",
    num_epochs=10,
    batch_size=8,
    learning_rate=5e-5
):
    """Main training function"""
    
    # Initialize model from scratch
    print("Initializing TrOCR model from scratch...")
    from transformers import VisionEncoderDecoderConfig, ViTConfig, RobertaConfig
    
    # Configure model architecture
    encoder_config = ViTConfig(
        image_size=384,
        patch_size=16,
        num_channels=3,
        hidden_size=768,
        num_hidden_layers=12,
        num_attention_heads=12,
        intermediate_size=3072
    )
    
    decoder_config = RobertaConfig(
        vocab_size=50265,
        hidden_size=768,
        num_hidden_layers=6,
        num_attention_heads=12,
        intermediate_size=3072,
        max_position_embeddings=514
    )
    
    config = VisionEncoderDecoderConfig.from_encoder_decoder_configs(encoder_config, decoder_config)
    
    # Initialize model with random weights
    model = VisionEncoderDecoderModel(config=config)
    processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-handwritten")  # Still need processor for tokenization
    
    # Set special tokens
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.vocab_size = model.config.decoder.vocab_size
    
    # Load datasets
    print("Loading training data...")
    train_images, train_texts = load_dataset(train_data_dir)
    print(f"Loaded {len(train_images)} training samples")
    
    print("Loading validation data...")
    val_images, val_texts = load_dataset(val_data_dir)
    print(f"Loaded {len(val_images)} validation samples")
    
    # Create datasets
    train_dataset = HandwritingDataset(train_images, train_texts, processor)
    val_dataset = HandwritingDataset(val_images, val_texts, processor)
    data_collator = CustomDataCollator(processor)

    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        num_train_epochs=num_epochs,
        learning_rate=learning_rate,
        warmup_steps=500,
        logging_steps=50,
        save_steps=500,
        eval_steps=500,
        evaluation_strategy="steps",
        save_strategy="steps",
        load_best_model_at_end=True,
        metric_for_best_model="cer",
        greater_is_better=False,
        report_to=None,  # Disable wandb/tensorboard logging
        dataloader_pin_memory=False,
        remove_unused_columns=False,

    )

    def compute_metrics(eval_pred):
        predictions, labels = eval_pred
        decoded_preds = processor.batch_decode(predictions, skip_special_tokens=True)
        labels = np.where(labels != -100, labels, processor.tokenizer.pad_token_id)
        decoded_labels = processor.batch_decode(labels, skip_special_tokens=True)

        cer_metric = evaluate.load("cer")
        wer_metric = evaluate.load("wer")
        cer = cer_metric.compute(predictions=decoded_preds, references=decoded_labels)
        wer = wer_metric.compute(predictions=decoded_preds, references=decoded_labels)
        return {"cer": cer, "wer": wer}
    
    # Initialize trainer
      # Use your custom trainer class here
    trainer = CustomTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
        data_collator=data_collator, # This is the correct place for it
    )
    
    # Train the model
    print("Starting training...")
    trainer.train()
    
    # Save the final model
    print(f"Saving model to {output_dir}")
    trainer.save_model()
    processor.save_pretrained(output_dir)
    
    # Evaluate final model
    print("Final evaluation...")
    eval_results = trainer.evaluate()
    print(f"Final CER: {eval_results['eval_cer']:.4f}")
    print(f"Final WER: {eval_results['eval_wer']:.4f}")
    
    return model, processor

def test_model(model_path, test_image_path):
    """Test the trained model on a single image"""
    processor = TrOCRProcessor.from_pretrained(model_path)
    model = VisionEncoderDecoderModel.from_pretrained(model_path)
    
    # Load and process image
    image = Image.open(test_image_path).convert('RGB')
    pixel_values = processor(image, return_tensors="pt").pixel_values
    
    # Generate text
    with torch.no_grad():
        generated_ids = model.generate(pixel_values)
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    
    return generated_text

if __name__ == "__main__":
    # Configuration
    TRAIN_DATA_DIR = "./data/train"
    VAL_DATA_DIR = "./data/val" 
    OUTPUT_DIR = "./handwriting-ocr-model"
    
    # Check for GPU
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    
    # Train the model
    model, processor = train_model(
        train_data_dir=TRAIN_DATA_DIR,
        val_data_dir=VAL_DATA_DIR,
        output_dir=OUTPUT_DIR,
        num_epochs=10,
        batch_size=4 if device.type == "cpu" else 8,
        learning_rate=5e-5
    )
    
    # Test the model (optional)
    # test_image = "./test_image.jpg"
    # if os.path.exists(test_image):
    #     result = test_model(OUTPUT_DIR, test_image)
    #     print(f"Extracted text: {result}")

