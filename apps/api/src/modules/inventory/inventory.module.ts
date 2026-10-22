import { Module } from '@nestjs/common';
import { ProductCommandsService } from './product-commands.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductCommandsService],
})
export class InventoryModule {}
