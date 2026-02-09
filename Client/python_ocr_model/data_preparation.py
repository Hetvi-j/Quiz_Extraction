#!/usr/bin/env python3
"""
Data preparation script for handwriting OCR training
Helps organize your dataset into the required format
"""

import os
import pandas as pd
import shutil
from PIL import Image
import argparse

def prepare_dataset(input_dir, output_dir, train_split=0.8, val_split=0.1):
    """
    Prepare dataset from a directory of images and text files
    
    Expected input structure:
    input_dir/
    ├── image1.jpg
    ├── image1.txt  (contains the text for image1.jpg)
    ├── image2.png
    ├── image2.txt
    └── ...
    
    Output structure:
    output_dir/
    ├── train/
    │   ├── images/
    │   └── labels.csv
    ├── val/
    │   ├── images/
    │   └── labels.csv
    └── test/
        ├── images/
        └── labels.csv
    """
    
    # Create output directories
    for split in ['train', 'val', 'test']:
        os.makedirs(os.path.join(output_dir, split, 'images'), exist_ok=True)
    
    # Find all image files
    image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff'}
    image_files = []
    
    for filename in os.listdir(input_dir):
        if any(filename.lower().endswith(ext) for ext in image_extensions):
            # Check if corresponding text file exists
            base_name = os.path.splitext(filename)[0]
            text_file = os.path.join(input_dir, base_name + '.txt')
            
            if os.path.exists(text_file):
                image_files.append(filename)
    
    print(f"Found {len(image_files)} image-text pairs")
    
    # Shuffle and split
    import random
    random.shuffle(image_files)
    
    n_total = len(image_files)
    n_train = int(n_total * train_split)
    n_val = int(n_total * val_split)
    
    splits = {
        'train': image_files[:n_train],
        'val': image_files[n_train:n_train + n_val],
        'test': image_files[n_train + n_val:]
    }
    
    # Process each split
    for split_name, files in splits.items():
        if not files:
            continue
            
        print(f"Processing {split_name} split: {len(files)} files")
        
        labels_data = []
        split_dir = os.path.join(output_dir, split_name)
        
        for filename in files:
            # Copy image
            src_image = os.path.join(input_dir, filename)
            dst_image = os.path.join(split_dir, 'images', filename)
            shutil.copy2(src_image, dst_image)
            
            # Read text
            base_name = os.path.splitext(filename)[0]
            text_file = os.path.join(input_dir, base_name + '.txt')
            
            with open(text_file, 'r', encoding='utf-8') as f:
                text = f.read().strip()
            
            labels_data.append({
                'filename': filename,
                'text': text
            })
        
        # Save labels CSV
        labels_df = pd.DataFrame(labels_data)
        labels_df.to_csv(os.path.join(split_dir, 'labels.csv'), index=False)
    
    print("Dataset preparation complete!")
    print(f"Train: {len(splits['train'])} samples")
    print(f"Validation: {len(splits['val'])} samples") 
    print(f"Test: {len(splits['test'])} samples")

def validate_images(data_dir):
    """Validate that all images can be opened and are valid"""
    print("Validating images...")
    
    for split in ['train', 'val', 'test']:
        split_dir = os.path.join(data_dir, split)
        if not os.path.exists(split_dir):
            continue
            
        labels_file = os.path.join(split_dir, 'labels.csv')
        if not os.path.exists(labels_file):
            continue
            
        df = pd.read_csv(labels_file)
        corrupted_files = []
        
        for _, row in df.iterrows():
            image_path = os.path.join(split_dir, 'images', row['filename'])
            try:
                with Image.open(image_path) as img:
                    img.verify()  # Verify the image
            except Exception as e:
                corrupted_files.append((row['filename'], str(e)))
        
        if corrupted_files:
            print(f"Found {len(corrupted_files)} corrupted files in {split}:")
            for filename, error in corrupted_files:
                print(f"  {filename}: {error}")
        else:
            print(f"{split}: All images are valid")

def augment_dataset(data_dir, output_dir, augmentation_factor=2):
    """
    Create augmented versions of the dataset
    Applies random rotations, noise, and other transformations
    """
    from PIL import ImageEnhance, ImageFilter
    import random
    
    print(f"Creating augmented dataset with factor {augmentation_factor}")
    
    # Copy original structure
    shutil.copytree(data_dir, output_dir, dirs_exist_ok=True)
    
    for split in ['train']:  # Usually only augment training data
        split_dir = os.path.join(data_dir, split)
        aug_split_dir = os.path.join(output_dir, split)
        
        if not os.path.exists(split_dir):
            continue
            
        labels_file = os.path.join(split_dir, 'labels.csv')
        df = pd.read_csv(labels_file)
        
        new_labels = []
        
        for _, row in df.iterrows():
            image_path = os.path.join(split_dir, 'images', row['filename'])
            
            # Create augmented versions
            for i in range(augmentation_factor):
                try:
                    with Image.open(image_path) as img:
                        # Apply random augmentations
                        augmented = img.copy()
                        
                        # Random rotation (-5 to 5 degrees)
                        angle = random.uniform(-5, 5)
                        augmented = augmented.rotate(angle, fillcolor=255)
                        
                        # Random brightness adjustment
                        enhancer = ImageEnhance.Brightness(augmented)
                        factor = random.uniform(0.8, 1.2)
                        augmented = enhancer.enhance(factor)
                        
                        # Random contrast adjustment
                        enhancer = ImageEnhance.Contrast(augmented)
                        factor = random.uniform(0.8, 1.2)
                        augmented = enhancer.enhance(factor)
                        
                        # Slight blur (occasionally)
                        if random.random() < 0.2:
                            augmented = augmented.filter(ImageFilter.GaussianBlur(radius=0.5))
                        
                        # Save augmented image
                        base_name, ext = os.path.splitext(row['filename'])
                        aug_filename = f"{base_name}_aug{i}{ext}"
                        aug_path = os.path.join(aug_split_dir, 'images', aug_filename)
                        augmented.save(aug_path)
                        
                        # Add to labels
                        new_labels.append({
                            'filename': aug_filename,
                            'text': row['text']
                        })
                        
                except Exception as e:
                    print(f"Error augmenting {row['filename']}: {e}")
        
        # Append new labels to existing CSV
        all_labels = pd.concat([df, pd.DataFrame(new_labels)], ignore_index=True)
        all_labels.to_csv(os.path.join(aug_split_dir, 'labels.csv'), index=False)
        
        print(f"Added {len(new_labels)} augmented samples to {split}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare dataset for handwriting OCR training")
    parser.add_argument("--input_dir", required=True, help="Input directory with images and text files")
    parser.add_argument("--output_dir", required=True, help="Output directory for prepared dataset")
    parser.add_argument("--train_split", type=float, default=0.8, help="Training split ratio")
    parser.add_argument("--val_split", type=float, default=0.1, help="Validation split ratio")
    parser.add_argument("--validate", action="store_true", help="Validate images after preparation")
    parser.add_argument("--augment", action="store_true", help="Create augmented dataset")
    parser.add_argument("--aug_factor", type=int, default=2, help="Augmentation factor")
    
    args = parser.parse_args()
    
    # Prepare dataset
    prepare_dataset(args.input_dir, args.output_dir, args.train_split, args.val_split)
    
    # Validate if requested
    if args.validate:
        validate_images(args.output_dir)
    
    # Augment if requested
    if args.augment:
        aug_output_dir = args.output_dir + "_augmented"
        augment_dataset(args.output_dir, aug_output_dir, args.aug_factor)