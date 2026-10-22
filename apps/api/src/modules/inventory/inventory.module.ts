import { Module } from '@nestjs/common';
import { EquivalencesController } from './equivalences.controller';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, EquivalencesController],
  providers: [ProductsService, ProductCommandsService, EquivalencesService],
})
export class InventoryModule {}
